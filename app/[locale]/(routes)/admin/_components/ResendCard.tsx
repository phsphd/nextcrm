// file: nextcrm/app/[locale]/(routes)/admin/_components/ResendCard.tsx
/*
This component manages system-wide Resend.com API key configuration for email services
Handles both environment variables and database-stored API keys

MIGRATION NOTES (MongoDB -> Supabase):
- Updated model name from 'systemServices' to 'systemServices' (kept as per schema)
- Enhanced validation for Resend API key format
- Improved error handling and security measures
- Better UI with status indicators and validation feedback
- Added proper key masking and security features
- Enhanced form validation and user feedback
- Added email service status indicators
- Fixed unescaped entities error
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
import { Mail, Database, Server, CheckCircle, AlertTriangle, Settings, Send } from "lucide-react";

// Enhanced validation schema for Resend API key
const resendKeySchema = z.object({
  id: z.string().optional(),
  serviceKey: z.string()
    .min(1, "API key is required")
    .regex(/^re_[a-zA-Z0-9]{32,}$/, "Invalid Resend API key format. Must start with 're_' followed by at least 32 characters")
    .refine(key => key.trim().length > 0, "API key cannot be empty")
});

// Types for better TypeScript support
interface ResendKeyConfig {
  id: string;
  serviceKey: string;
  description: string | null;
  serviceUrl: string | null;
}

interface EmailServiceStatus {
  envKeyExists: boolean;
  dbKeyExists: boolean;
  isActive: boolean;
  activeSource: 'environment' | 'database' | 'none';
}

const ResendCard = async () => {
  // Server action for setting Resend key
  const setSMTP = async (formData: FormData) => {
    "use server";
    
    try {
      console.log("Processing Resend API key update...");
      
      // Parse and validate form data
      const rawData = {
        id: formData.get("id") as string || undefined,
        serviceKey: formData.get("serviceKey") as string,
      };

      const parsed = resendKeySchema.parse(rawData);
      const sanitizedKey = parsed.serviceKey.trim();

      if (!parsed.id) {
        // Create new Resend key configuration
        await prismadb.systemServices.create({
          data: {
            v: 0,
            name: "resend_smtp",
            serviceKey: sanitizedKey,
            description: "Resend.com API key for email services",
            serviceUrl: "https://api.resend.com",
          },
        });
        console.log("Created new Resend key configuration");
      } else {
        // Update existing Resend key configuration
        await prismadb.systemServices.update({
          where: {
            id: parsed.id,
          },
          data: {
            serviceKey: sanitizedKey,
            description: "Resend.com API key for email services",
            serviceUrl: "https://api.resend.com",
          },
        });
        console.log("Updated existing Resend key configuration");
      }
      
      // Revalidate the admin page to show updated data
      revalidatePath("/admin");
      
    } catch (error) {
      console.error("Error setting Resend key:", error);
      
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
      
      throw new Error("Failed to save Resend API key. Please try again.");
    }
  };

  try {
    // Fetch current Resend key configuration
    const resend_key: ResendKeyConfig | null = await prismadb.systemServices.findFirst({
      where: {
        name: "resend_smtp",
      },
      select: {
        id: true,
        serviceKey: true,
        description: true,
        serviceUrl: true,
      }
    });

    console.log(`Resend key configuration: ${resend_key ? 'found' : 'not found'}`);

    // Determine email service status
    const envKeyExists = !!process.env.RESEND_API_KEY;
    const dbKeyExists = !!resend_key?.serviceKey;
    
    const emailStatus: EmailServiceStatus = {
      envKeyExists,
      dbKeyExists,
      isActive: envKeyExists || dbKeyExists,
      activeSource: envKeyExists ? 'environment' : dbKeyExists ? 'database' : 'none'
    };

    return (
      <Card className="min-w-[350px] max-w-[450px] h-fit">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Send className="h-5 w-5 text-green-600" />
            <CardTitle className="text-lg">Resend.com Email Service</CardTitle>
          </div>
          <CardDescription className="text-sm">
            Configure Resend.com API key for transactional email delivery
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Status Overview */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <Settings className="h-4 w-4" />
              Email Service Status
            </div>

            {/* Environment Variable Status */}
            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              <div className="flex items-center gap-2">
                <Server className="h-4 w-4 text-gray-600" />
                <span className="text-sm font-medium">Environment Variable</span>
              </div>
              <div className="flex items-center gap-2">
                {emailStatus.envKeyExists ? (
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

            {emailStatus.envKeyExists && (
              <div className="pl-6 text-xs text-gray-600">
                <CopyKeyComponent
                  keyValue={process.env.RESEND_API_KEY!}
                  message="Environment Resend API Key"
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
                {emailStatus.dbKeyExists ? (
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

            {emailStatus.dbKeyExists && resend_key?.serviceKey && (
              <div className="pl-6 text-xs text-gray-600">
                <CopyKeyComponent
                  keyValue={resend_key.serviceKey}
                  message="Database Resend API Key"
                />
              </div>
            )}
          </div>

          {/* Configuration Priority Alert */}
          {emailStatus.envKeyExists && emailStatus.dbKeyExists && (
            <Alert className="border-blue-200 bg-blue-50">
              <Settings className="h-4 w-4 text-blue-600" />
              <AlertDescription className="text-blue-700 text-sm">
                Both environment and database keys are configured. Environment variable takes precedence.
              </AlertDescription>
            </Alert>
          )}

          {!emailStatus.isActive && (
            <Alert className="border-amber-200 bg-amber-50">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-amber-700 text-sm">
                No Resend API key configured. Email sending functionality will not be available.
              </AlertDescription>
            </Alert>
          )}

          {/* Email Service Features */}
          {emailStatus.isActive && (
            <Alert className="border-green-200 bg-green-50">
              <Mail className="h-4 w-4 text-green-600" />
              <AlertDescription className="text-green-700 text-sm">
                Email service is active. Available features: transactional emails, notifications, password resets.
              </AlertDescription>
            </Alert>
          )}

          {/* Configuration Form */}
          <div className="space-y-3 border-t pt-4">
            <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <Database className="h-4 w-4" />
              Database Configuration
            </div>

            <form action={setSMTP} className="space-y-3">
              <input type="hidden" name="id" value={resend_key?.id || ""} />
              
              <div className="space-y-2">
                <Label htmlFor="serviceKey" className="text-sm">
                  Resend API Key
                </Label>
                <Input
                  id="serviceKey"
                  name="serviceKey"
                  type="password"
                  placeholder="re_..."
                  className="font-mono text-sm"
                  defaultValue=""
                  autoComplete="off"
                  aria-describedby="serviceKey-help"
                />
                <p id="serviceKey-help" className="text-xs text-gray-500">
                  Enter your Resend.com API key (starts with &quot;re_&quot;)
                </p>
              </div>

              <div className="flex justify-end gap-2">
                <Button type="reset" variant="outline" size="sm">
                  Reset
                </Button>
                <Button type="submit" size="sm">
                  {resend_key?.id ? "Update" : "Set"} Resend Key
                </Button>
              </div>
            </form>
          </div>

          {/* Configuration Info */}
          <div className="border-t pt-4 text-xs text-gray-600 space-y-1">
            <div className="flex justify-between">
              <span>Email service:</span>
              <span className="font-medium">
                {emailStatus.isActive ? "Active" : "Inactive"}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Configuration source:</span>
              <span className="font-medium capitalize">
                {emailStatus.activeSource}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Service provider:</span>
              <span className="font-medium">Resend.com</span>
            </div>
            {resend_key?.serviceUrl && (
              <div className="flex justify-between">
                <span>API endpoint:</span>
                <span className="font-medium truncate ml-2">{resend_key.serviceUrl}</span>
              </div>
            )}
            {resend_key?.description && (
              <div className="flex justify-between">
                <span>Description:</span>
                <span className="font-medium truncate ml-2">{resend_key.description}</span>
              </div>
            )}
          </div>

          {/* Service Features */}
          <div className="border-t pt-4">
            <div className="text-xs text-gray-600">
              <div className="font-medium mb-2">Available Email Features:</div>
              <ul className="space-y-1 ml-2">
                <li className="flex items-center gap-2">
                  <div className={`h-2 w-2 rounded-full ${emailStatus.isActive ? 'bg-green-500' : 'bg-gray-300'}`}></div>
                  <span>User registration emails</span>
                </li>
                <li className="flex items-center gap-2">
                  <div className={`h-2 w-2 rounded-full ${emailStatus.isActive ? 'bg-green-500' : 'bg-gray-300'}`}></div>
                  <span>Password reset emails</span>
                </li>
                <li className="flex items-center gap-2">
                  <div className={`h-2 w-2 rounded-full ${emailStatus.isActive ? 'bg-green-500' : 'bg-gray-300'}`}></div>
                  <span>Invoice notifications</span>
                </li>
                <li className="flex items-center gap-2">
                  <div className={`h-2 w-2 rounded-full ${emailStatus.isActive ? 'bg-green-500' : 'bg-gray-300'}`}></div>
                  <span>Task notifications</span>
                </li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    );

  } catch (error) {
    console.error("Error loading Resend configuration:", error);
    
    // Error fallback UI
    return (
      <Card className="min-w-[350px] max-w-[450px] h-fit">
        <CardHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-red-500" />
            <CardTitle className="text-lg">Resend.com Email Service</CardTitle>
          </div>
          <CardDescription className="text-red-600">
            Error loading configuration
          </CardDescription>
        </CardHeader>
        
        <CardContent>
          <Alert className="border-red-200 bg-red-50">
            <AlertTriangle className="h-4 w-4 text-red-600" />
            <AlertDescription className="text-red-700 text-sm">
              Failed to load Resend configuration. Please refresh the page or contact support.
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

export default ResendCard;