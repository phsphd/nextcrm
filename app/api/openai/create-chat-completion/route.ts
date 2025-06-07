// file: nextcrm/app/api/openai/create-chat-completion/route.ts
/*
This route handles OpenAI chat completions for the AI assistant feature
Provides secure access to OpenAI API with proper authentication and validation

MIGRATION NOTES (MongoDB -> Supabase):
- Updated model name from 'gpt_models' to 'gpt_models' (kept as per schema)
- Enhanced security with proper user authentication and rate limiting
- Improved error handling and validation
- Better OpenAI integration with enhanced configuration
- Added usage tracking and logging
- Enhanced prompt validation and safety measures
- Better response handling and error recovery
*/

import { NextResponse } from "next/server";
import { prismadb } from "@/lib/prisma";
import { openAiHelper } from "@/lib/openai";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";

export const maxDuration = 300; // 5 minutes

// Enhanced validation schema
const chatCompletionSchema = z.object({
  prompt: z.string()
    .min(1, "Prompt is required")
    .max(4000, "Prompt is too long (max 4000 characters)")
    .refine(prompt => prompt.trim().length > 0, "Prompt cannot be empty"),
  userId: z.string().min(1, "User ID is required"),
  temperature: z.number().min(0).max(2).optional().default(0.7),
  maxTokens: z.number().min(1).max(4000).optional().default(1000),
  systemPrompt: z.string().optional(),
  conversationId: z.string().optional(),
});

// Rate limiting (simple in-memory store - use Redis in production)
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_REQUESTS = 20; // requests per hour per user
const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour in milliseconds

function checkRateLimit(userId: string): { allowed: boolean; resetTime?: number } {
  const now = Date.now();
  const userLimit = rateLimitStore.get(userId);

  if (!userLimit || now > userLimit.resetTime) {
    // Reset or create new limit
    rateLimitStore.set(userId, {
      count: 1,
      resetTime: now + RATE_LIMIT_WINDOW
    });
    return { allowed: true };
  }

  if (userLimit.count >= RATE_LIMIT_REQUESTS) {
    return { allowed: false, resetTime: userLimit.resetTime };
  }

  // Increment count
  userLimit.count++;
  return { allowed: true };
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);

  // Enhanced authentication
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!session.user?.id) {
    return NextResponse.json({ error: "User ID not found in session" }, { status: 401 });
  }

  try {
    const body = await req.json();
    console.log(`AI chat request from user: ${session.user.email}`);

    // Validate request data
    const validatedData = chatCompletionSchema.parse(body);
    const { prompt, userId, temperature, maxTokens, systemPrompt, conversationId } = validatedData;

    // Security check: ensure user can only make requests for themselves (unless admin)
    if (session.user.id !== userId && !session.user.is_admin) {
      console.warn(`User ${session.user.id} attempted to make AI request for user ${userId}`);
      return NextResponse.json(
        { error: "You can only make AI requests for yourself" },
        { status: 403 }
      );
    }

    // Rate limiting
    const rateLimitResult = checkRateLimit(userId);
    if (!rateLimitResult.allowed) {
      const resetDate = new Date(rateLimitResult.resetTime!);
      return NextResponse.json(
        {
          error: "Rate limit exceeded",
          message: `Too many requests. Limit resets at ${resetDate.toISOString()}`,
          resetTime: rateLimitResult.resetTime
        },
        { 
          status: 429,
          headers: {
            'X-RateLimit-Limit': RATE_LIMIT_REQUESTS.toString(),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': rateLimitResult.resetTime!.toString()
          }
        }
      );
    }

    // Get OpenAI client
    const openai = await openAiHelper(userId);
    if (!openai) {
      console.error(`No OpenAI configuration found for user: ${userId}`);
      return NextResponse.json(
        { 
          error: "OpenAI configuration not found",
          message: "Please configure your OpenAI API key in settings"
        },
        { status: 503 }
      );
    }

    // Get active GPT model
    const activeModel = await prismadb.gpt_models.findFirst({
      where: {
        status: "ACTIVE",
      },
      select: {
        id: true,
        model: true,
        description: true,
      }
    });

    if (!activeModel) {
      console.error("No active GPT model found");
      return NextResponse.json(
        {
          error: "No AI model available",
          message: "No active AI model is configured. Please contact your administrator."
        },
        { status: 503 }
      );
    }

    console.log(`Using GPT model: ${activeModel.model} for user: ${session.user.email}`);

    // Prepare messages
    const messages: any[] = [
      {
        role: "system",
        content: systemPrompt || "You are a helpful AI assistant for NextCRM. Provide accurate, professional, and helpful responses to assist users with their CRM-related tasks and questions."
      },
      {
        role: "user",
        content: prompt.trim()
      }
    ];

    // Create chat completion
    const startTime = Date.now();
    const response = await openai.chat.completions.create({
      messages,
      model: activeModel.model,
      temperature,
      max_tokens: maxTokens,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0,
    });

    const endTime = Date.now();
    const responseTime = endTime - startTime;

    // Log usage for analytics
    console.log(`AI completion successful - Model: ${activeModel.model}, Tokens: ${response.usage?.total_tokens}, Time: ${responseTime}ms`);

    // Prepare response data
    const completionResult = {
      id: response.id,
      model: response.model,
      content: response.choices[0]?.message?.content || "",
      finishReason: response.choices[0]?.finish_reason,
      usage: {
        promptTokens: response.usage?.prompt_tokens || 0,
        completionTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0,
      },
      responseTime,
      conversationId,
      timestamp: new Date().toISOString(),
    };

    return NextResponse.json(
      {
        success: true,
        response: completionResult,
        model: {
          id: activeModel.id,
          name: activeModel.model,
          description: activeModel.description,
        }
      },
      { 
        status: 200,
        headers: {
          'X-RateLimit-Limit': RATE_LIMIT_REQUESTS.toString(),
          'X-RateLimit-Remaining': (RATE_LIMIT_REQUESTS - (rateLimitStore.get(userId)?.count || 0)).toString(),
        }
      }
    );

  } catch (error) {
    console.error("[OPENAI_CHAT_POST] Error:", error);

    // Handle specific OpenAI errors
    if (error instanceof Error) {
      // OpenAI API errors
      if (error.message.includes('insufficient_quota')) {
        return NextResponse.json(
          {
            error: "OpenAI quota exceeded",
            message: "Your OpenAI API quota has been exceeded. Please check your OpenAI account."
          },
          { status: 402 }
        );
      }

      if (error.message.includes('invalid_api_key')) {
        return NextResponse.json(
          {
            error: "Invalid OpenAI API key",
            message: "Your OpenAI API key is invalid. Please update it in settings."
          },
          { status: 401 }
        );
      }

      if (error.message.includes('model_not_found')) {
        return NextResponse.json(
          {
            error: "AI model not available",
            message: "The selected AI model is not available. Please contact your administrator."
          },
          { status: 503 }
        );
      }

      if (error.message.includes('rate_limit_exceeded')) {
        return NextResponse.json(
          {
            error: "OpenAI rate limit exceeded",
            message: "OpenAI API rate limit exceeded. Please try again later."
          },
          { status: 429 }
        );
      }
    }

    // Handle Zod validation errors
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: "Validation failed",
          details: error.errors.map(err => `${err.path.join('.')}: ${err.message}`)
        },
        { status: 400 }
      );
    }

    // Generic error response
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    
    return NextResponse.json(
      {
        error: "AI completion failed",
        message: "An error occurred while processing your request. Please try again.",
        details: process.env.NODE_ENV === 'development' ? errorMessage : undefined
      },
      { status: 500 }
    );
  }
}

// Optional: Add GET method for model information
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Get available models
    const models = await prismadb.gpt_models.findMany({
      select: {
        id: true,
        model: true,
        description: true,
        status: true,
      },
      orderBy: {
        status: 'desc' // ACTIVE models first
      }
    });

    const activeModel = models.find(model => model.status === "ACTIVE");

    return NextResponse.json(
      {
        success: true,
        models,
        activeModel,
        availability: {
          openaiConfigured: true, // You might want to check this dynamically
          modelActive: !!activeModel,
          featuresEnabled: true,
        }
      },
      { status: 200 }
    );

  } catch (error) {
    console.error("[OPENAI_MODELS_GET] Error:", error);
    
    return NextResponse.json(
      {
        error: "Failed to retrieve model information",
        details: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
}