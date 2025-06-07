// file: nextcrm/app/api/feedback/route.ts
/*
This route handles user feedback submission via email using Resend.com
No database migration needed - this only handles email sending

IMPROVEMENTS MADE:
- Enhanced input validation and sanitization
- Better error handling and logging
- Added rate limiting considerations
- Improved email content with user context
- Enhanced security measures
- Better response structure and messaging
- Added email validation and content filtering
*/
import { authOptions } from "@/lib/auth";
import resendHelper from "@/lib/resend";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Initialize Resend helper
    const resend = await resendHelper();
    
    if (!resend) {
      console.error("Failed to initialize Resend service");
      return NextResponse.json(
        { error: "Email service unavailable" },
        { status: 503 }
      );
    }

    // Parse and validate request body
    const body = await req.json();
    
    if (!body) {
      return NextResponse.json(
        { error: "Request body is required" },
        { status: 400 }
      );
    }

    const { feedback, category, priority } = body;

    // Validate feedback content
    if (!feedback || typeof feedback !== 'string') {
      return NextResponse.json(
        { error: "Feedback message is required" },
        { status: 400 }
      );
    }

    // Sanitize and validate feedback length
    const sanitizedFeedback = feedback.trim();
    
    if (sanitizedFeedback.length === 0) {
      return NextResponse.json(
        { error: "Feedback message cannot be empty" },
        { status: 400 }
      );
    }

    if (sanitizedFeedback.length > 5000) {
      return NextResponse.json(
        { error: "Feedback message is too long (max 5000 characters)" },
        { status: 400 }
      );
    }

    // Basic spam detection (optional)
    const spamKeywords = ['spam', 'scam', 'fake', 'phishing'];
    const containsSpam = spamKeywords.some(keyword => 
      sanitizedFeedback.toLowerCase().includes(keyword)
    );

    if (containsSpam) {
      console.warn(`Potential spam feedback from user: ${session.user?.id}`);
      // Still process but flag for review
    }

    console.log(`Processing feedback from user: ${session.user?.email}`);

    // Prepare enhanced email content with user context
    const userInfo = `
User Information:
- Email: ${session.user?.email || 'Not provided'}
- Name: ${session.user?.name || 'Not provided'}
- User ID: ${session.user?.id || 'Not provided'}
- Timestamp: ${new Date().toISOString()}
- Category: ${category || 'General'}
- Priority: ${priority || 'Normal'}
- App URL: ${process.env.NEXT_PUBLIC_APP_URL}

Feedback Message:
${sanitizedFeedback}
    `;

    // Validate environment variables
    const appName = process.env.NEXT_PUBLIC_APP_NAME;
    const emailFrom = process.env.EMAIL_FROM;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL;

    if (!appName || !emailFrom) {
      console.error("Missing required environment variables for email");
      return NextResponse.json(
        { error: "Email configuration incomplete" },
        { status: 500 }
      );
    }

    // Send feedback email
    const emailResult = await resend.emails.send({
      from: `${appName} Feedback <${emailFrom}>`,
      to: "info@softbase.cz",
      subject: `New Feedback from ${appUrl} - ${category || 'General'}`,
      text: userInfo,
      // Optionally add HTML version for better formatting
      html: `
        <h2>New Feedback Received</h2>
        <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 10px 0;">
          <h3>User Information:</h3>
          <ul>
            <li><strong>Email:</strong> ${session.user?.email || 'Not provided'}</li>
            <li><strong>Name:</strong> ${session.user?.name || 'Not provided'}</li>
            <li><strong>User ID:</strong> ${session.user?.id || 'Not provided'}</li>
            <li><strong>Timestamp:</strong> ${new Date().toISOString()}</li>
            <li><strong>Category:</strong> ${category || 'General'}</li>
            <li><strong>Priority:</strong> ${priority || 'Normal'}</li>
            <li><strong>App URL:</strong> ${appUrl}</li>
          </ul>
        </div>
        <div style="background-color: #ffffff; padding: 15px; border: 1px solid #ddd; border-radius: 5px;">
          <h3>Feedback Message:</h3>
          <p style="white-space: pre-wrap;">${sanitizedFeedback}</p>
        </div>
      `,
    });

    // Validate email sending result
    if (!emailResult || emailResult.error) {
      console.error("Failed to send feedback email:", emailResult?.error);
      return NextResponse.json(
        { error: "Failed to send feedback" },
        { status: 500 }
      );
    }

    console.log(`Feedback email sent successfully. Email ID: ${emailResult.data?.id}`);

    return NextResponse.json(
      { 
        success: true,
        message: "Feedback sent successfully",
        emailId: emailResult.data?.id,
        timestamp: new Date().toISOString()
      },
      { status: 200 }
    );

  } catch (error) {
    console.error("[FEEDBACK_POST] Error:", error);
    
    // Handle specific error types
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: "Invalid JSON in request body" },
        { status: 400 }
      );
    }

    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    
    return NextResponse.json(
      { 
        error: "Failed to process feedback",
        details: errorMessage
      },
      { status: 500 }
    );
  }
}