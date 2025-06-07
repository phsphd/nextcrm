// file: nextcrm/app/[locale]/(routes)/admin/_components/OpenAiCard.tsx
/*
This component manages system-wide OpenAI API key configuration for administrators
Handles both environment variables and database-stored API keys

MIGRATION NOTES (MongoDB -> Supabase):
- Updated model name from 'systemServices' to 'systemServices' (kept as per schema)
- Enhanced validation for OpenAI API key format
- Improved error handling and security measures
- Better UI with status indicators and validation feedback
- Added proper key masking and security features
- Enhanced form validation and user feedback
- Added key testing functionality considerations
- Fixed server action error handling and validation
- Enhanced TypeScript types and error boundaries
- Improved accessibility and user experience
*/
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { z } from "zod";
import { prismadb } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import CopyKeyComponent from "./copy-key";
import { Key, Database, Server, CheckCircle, AlertTriangle, Settings } from "lucide-react";

// Enhanced validation schema for OpenAI API key
const openAiKeySchema = z.object({
  id: z.string().optional(),
  serviceKey: z.string()
    .min(1, "API key is required")
    .regex(/^sk-[a-zA-Z0-9]{48}$/, "Invalid OpenAI API key format. Must start with 'sk-' followed by 48 characters")
    .refine(key => key.trim().length > 0, "API key cannot be empty")
});

// Types for better TypeScript support
interface OpenAIKeyConfig {
  id: string;
  serviceKey: string;
  description: string | null;
  serviceUrl: string | null;
}

interface ConfigurationStatus {
  envKeyExists: boolean;
  dbKeyExists: boolean;
  activeSource: 'environment' | 'database' | 'none';
  configMethod: string;
}

const OpenAiCard = async () => {
  // Server action for setting OpenAI key
  const setOpenAiKey = async (formData: FormData) => {
    "use server";
    
    try {
      console.log("Processing OpenAI API key update...");
      
      // Parse and validate form data
      const rawData = {
        id: formData.get("id") as string || undefined,
        serviceKey: formData.get("serviceKey") as string,
      };

      const parsed = openAiKeySchema.parse(rawData);
      const sanitizedKey = parsed.serviceKey.trim();

      if (!parsed.id) {
        // Create new OpenAI key configuration
        await prismadb.systemServices.create({
          data: {
            v: 0,
            name: "openAiKey",
            serviceKey: sanitizedKey,
            description: "System-wide OpenAI API key for AI features",
            serviceUrl: "https://api.openai.com/v1",
          },
        });
        console.log("Created new OpenAI key configuration");
      } else {
        // Update existing OpenAI key configuration
        await prismadb.systemServices.update({
          where: {
            id: parsed.id,
          },
          data: {
            serviceKey: sanitizedKey,
            description: "System-wide OpenAI API key for AI features",
            serviceUrl: "https://api.openai.com/v1",
          },
        });
        console.log("Updated existing OpenAI key configuration");
      }
      
      // Revalidate the admin page to show updated data
      revalidatePath("/admin");
      
    } catch (error) {
      console.error("Error setting OpenAI key:", error);
      
      if (error instanceof z.ZodError) {
        // Handle validation errors
        const errorMessages = error.errors.map(err => `${err.path.join('.')}: ${err.message}`).join(", ");
        throw new Error(`Validation failed: ${errorMessages}`);
      }
      
      // Handle Prisma errors
      if (error && typeof error === 'object' && 'code' in error) {
        const prismaError = error as any;
        switch (prismaError.code) {
          case 'P2002':
            throw new Error("A configuration with this name already exists");
          case 'P2025':
            throw new Error("Configuration not found");
          default:
            console.error('Unhandled Prisma error:', prismaError);
        }
      }
      
      throw new Error("Failed to save OpenAI API key. Please try again.");
    }
  };

  try {
    // Fetch current OpenAI key configuration
    const openAi_key: OpenAIKeyConfig | null = await prismadb.systemServices.findFirst({
      where: {
        name: "openAiKey",
      },
      select: {
        id: true,
        serviceKey: true,
        description: true,
        serviceUrl: true,
      }
    });

    console.log(`OpenAI key configuration: ${openAi_key ? 'found' : 'not found'}`);

    // Determine configuration status
    const envKeyExists = !!process.env.OPENAI_API_KEY;
    const dbKeyExists = !!openAi_key?.serviceKey;
    
    const configStatus: ConfigurationStatus = {
      envKeyExists,
      dbKeyExists,
      activeSource: envKeyExists ? 'environment' : dbKeyExists ? 'database' : 'none',
      configMethod: envKeyExists && dbKeyExists ? "Environment + Database" : 
                   envKeyExists ? "Environment only" : 
                   dbKeyExists ? "Database only" : "None"
    };

    return (
      <Card className="min-w-[350px] max-w-[450px] h-fit">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Key className="h-5 w-5 text-blue-600" />
            <CardTitle className="text-lg">OpenAI API Configuration</CardTitle>
          </div>
          <CardDescription className="text-sm">
            Configure system-wide OpenAI API key for AI assistant features
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Status Overview */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <Settings className="h-4 w-4" />
              Configuration Status
            </div>

            {/* Environment Variable Status */}
            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              <div className="flex items-center gap-2">
                <Server className="h-4 w-4 text-gray-600" />
                <span className="text-sm font-medium">Environment Variable</span>
              </div>
              <div className="flex items-center gap-2">
                {configStatus.envKeyExists ? (
                  <>
                    <CheckCircle className="h-4 w-4 text-green-500" />
                    <Badge variant="secondary" className="bg-green-100 text-green-700 text-xs">
                      Configured
                    </Badge>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                    <Badge variant="secondary" className="bg-amber-100 text-amber-700 text-xs">
                      Not Set
                    </Badge>
                  </>
                )}
              </div>
            </div>

            {configStatus.envKeyExists && (
              <div className="pl-6 text-xs text-gray-600">
                <CopyKeyComponent
                  envValue={process.env.OPENAI_API_KEY!}
                  message="Environment OpenAI API Key"
                />
              </div>
            )}

            {/* Database Configuration Status */}
            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              <div className="flex items-center gap-2">
                <Database className="h-4 w-4 text-gray-600" />
                <span className="text-sm font-medium">Database Configuration</span>
              </div>
              <div className="flex items-center gap-2">
                {configStatus.dbKeyExists ? (
                  <>
                    <CheckCircle className="h-4 w-4 text-green-500" />
                    <Badge variant="secondary" className="bg-green-100 text-green-700 text-xs">
                      Configured
                    </Badge>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                    <Badge variant="secondary" className="bg-amber-100 text-amber-700 text-xs">
                      Not Set
                    </Badge>
                  </>
                )}
              </div>
            </div>

            {configStatus.dbKeyExists && openAi_key?.serviceKey && (
              <div className="pl-6 text-xs text-gray-600">
                <CopyKeyComponent
                  keyValue={openAi_key.serviceKey}
                  message="Database OpenAI API Key"
                />
              </div>
            )}
          </div>

          {/* Configuration Priority Alert */}
          {configStatus.envKeyExists && configStatus.dbKeyExists && (
            <Alert className="border-blue-200 bg-blue-50">
              <Settings className="h-4 w-4 text-blue-600" />
              <AlertDescription className="text-blue-700 text-sm">
                Both environment and database keys are configured. Environment variable takes precedence.
              </AlertDescription>
            </Alert>
          )}

          {configStatus.activeSource === 'none' && (
            <Alert className="border-amber-200 bg-amber-50">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-amber-700 text-sm">
                No OpenAI API key configured. AI assistant features will not be available.
              </AlertDescription>
            </Alert>
          )}

          {/* Configuration Form */}
          <div className="space-y-3 border-t pt-4">
            <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <Database className="h-4 w-4" />
              Database Configuration
            </div>

            <form action={setOpenAiKey} className="space-y-3">
              <input type="hidden" name="id" value={openAi_key?.id || ""} />
              
              <div className="space-y-2">
                <Label htmlFor="serviceKey" className="text-sm">
                  OpenAI API Key
                </Label>
                <Input
                  id="serviceKey"
                  name="serviceKey"
                  type="password"
                  placeholder="sk-..."
                  className="font-mono text-sm"
                  defaultValue=""
                  autoComplete="off"
                  aria-describedby="serviceKey-help"
                />
                <p id="serviceKey-help" className="text-xs text-gray-500">
                  Enter your OpenAI API key (starts with &quot;sk-&quot;)
                </p>
              </div>

              <div className="flex justify-end gap-2">
                <Button type="reset" variant="outline" size="sm">
                  Reset
                </Button>
                <Button type="submit" size="sm">
                  {openAi_key?.id ? "Update" : "Set"} API Key
                </Button>
              </div>
            </form>
          </div>

          {/* Configuration Info */}
          <div className="border-t pt-4 text-xs text-gray-600 space-y-1">
            <div className="flex justify-between">
              <span>Configuration method:</span>
              <span className="font-medium">
                {configStatus.configMethod}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Active key source:</span>
              <span className="font-medium capitalize">
                {configStatus.activeSource}
              </span>
            </div>
            {openAi_key?.serviceUrl && (
              <div className="flex justify-between">
                <span>API endpoint:</span>
                <span className="font-medium truncate ml-2">{openAi_key.serviceUrl}</span>
              </div>
            )}
            {openAi_key?.description && (
              <div className="flex justify-between">
                <span>Description:</span>
                <span className="font-medium truncate ml-2">{openAi_key.description}</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );

  } catch (error) {
    console.error("Error loading OpenAI configuration:", error);
    
    // Error fallback UI
    return (
      <Card className="min-w-[350px] max-w-[450px] h-fit">
        <CardHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-red-500" />
            <CardTitle className="text-lg">OpenAI API Configuration</CardTitle>
          </div>
          <CardDescription className="text-red-600">
            Error loading configuration
          </CardDescription>
        </CardHeader>
        
        <CardContent>
          <Alert className="border-red-200 bg-red-50">
            <AlertTriangle className="h-4 w-4 text-red-600" />
            <AlertDescription className="text-red-700 text-sm">
              Failed to load OpenAI configuration. Please refresh the page or contact support.
              {error instanceof Error && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs">Error details</summary>
                  <pre className="mt-1 text-xs bg-red-100 p-2 rounded overflow-auto">
                    {error.message}
                  </pre>
                </details>
              )}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }
};

export default OpenAiCard;