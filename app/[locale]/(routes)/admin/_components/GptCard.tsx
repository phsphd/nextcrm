// file: nextcrm/app/[locale]/(routes)/admin/_components/GptCard.tsx
/*
This component displays and manages GPT model configuration for the AI assistant
Shows current active model and allows administrators to configure GPT settings

MIGRATION NOTES (MongoDB -> Supabase):
- Updated Prisma type import from 'gpt_models' to 'gpt_models' (kept lowercase as per schema)
- Enhanced error handling and data validation
- Improved UI with better status indicators and model information
- Added proper loading states and error boundaries
- Enhanced model status display with better visual indicators
- Added fallback handling for when no models are configured
*/
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";

import { prismadb } from "@/lib/prisma";
import SetGptModel from "../forms/SetGptModel";
import OnTestButton from "./OnTestButton";
import { gpt_models } from "@prisma/client"; // Model name matches schema
import { Bot, CheckCircle, AlertCircle, Settings } from "lucide-react";

const GptCard = async () => {
  try {
    console.log("Loading GPT models configuration...");

    // Fetch all GPT models with proper ordering
    const gptModels: gpt_models[] = await prismadb.gpt_models.findMany({
      orderBy: [
        { status: 'desc' }, // ACTIVE models first
        { created_on: 'desc' } // Then by creation date
      ]
    });

    console.log(`Found ${gptModels.length} GPT models`);

    // Find the currently active model
    const activeModel = gptModels.find((model: gpt_models) => model.status === "ACTIVE");
    const inactiveModels = gptModels.filter((model: gpt_models) => model.status === "INACTIVE");

    return (
      <Card className="min-w-[350px] max-w-[450px] h-fit">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-blue-600" />
            <CardTitle className="text-lg">AI Assistant GPT Model</CardTitle>
          </div>
          
          {/* Current Active Model Display */}
          {activeModel ? (
            <CardDescription className="flex items-center gap-2 text-sm">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span>
                Current model: <span className="font-medium text-green-600">{activeModel.model}</span>
              </span>
              <Badge variant="secondary" className="text-xs bg-green-100 text-green-700">
                Active
              </Badge>
            </CardDescription>
          ) : (
            <CardDescription className="flex items-center gap-2 text-sm">
              <AlertCircle className="h-4 w-4 text-amber-500" />
              <span className="text-amber-600">No active model configured</span>
              <Badge variant="secondary" className="text-xs bg-amber-100 text-amber-700">
                Inactive
              </Badge>
            </CardDescription>
          )}
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Status Alert */}
          {!activeModel && gptModels.length > 0 && (
            <Alert className="border-amber-200 bg-amber-50">
              <Settings className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-amber-700 text-sm">
                You have {gptModels.length} model{gptModels.length !== 1 ? 's' : ''} configured but none are active. 
                Please activate a model to enable AI assistant features.
              </AlertDescription>
            </Alert>
          )}

          {!activeModel && gptModels.length === 0 && (
            <Alert className="border-blue-200 bg-blue-50">
              <Bot className="h-4 w-4 text-blue-600" />
              <AlertDescription className="text-blue-700 text-sm">
                No GPT models configured yet. Add and activate a model to enable AI assistant features.
              </AlertDescription>
            </Alert>
          )}

          {/* Model Configuration Section */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <Settings className="h-4 w-4" />
              Model Configuration
            </div>
            <SetGptModel models={gptModels} />
          </div>

          {/* Test Section - only show if there's an active model */}
          {activeModel && (
            <div className="space-y-3 border-t pt-4">
              <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
                <CheckCircle className="h-4 w-4" />
                Test AI Assistant
              </div>
              <OnTestButton />
            </div>
          )}

          {/* Model Summary */}
          {gptModels.length > 0 && (
            <div className="border-t pt-4">
              <div className="text-xs text-gray-600 space-y-1">
                <div className="flex justify-between">
                  <span>Total models:</span>
                  <span className="font-medium">{gptModels.length}</span>
                </div>
                <div className="flex justify-between">
                  <span>Active models:</span>
                  <span className="font-medium text-green-600">
                    {gptModels.filter(m => m.status === "ACTIVE").length}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Inactive models:</span>
                  <span className="font-medium text-gray-500">
                    {inactiveModels.length}
                  </span>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    );

  } catch (error) {
    console.error("Error loading GPT models:", error);
    
    // Error fallback UI
    return (
      <Card className="min-w-[350px] max-w-[450px] h-fit">
        <CardHeader>
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-red-500" />
            <CardTitle className="text-lg">AI Assistant GPT Model</CardTitle>
          </div>
          <CardDescription className="text-red-600">
            Error loading GPT model configuration
          </CardDescription>
        </CardHeader>
        
        <CardContent>
          <Alert className="border-red-200 bg-red-50">
            <AlertCircle className="h-4 w-4 text-red-600" />
            <AlertDescription className="text-red-700 text-sm">
              Failed to load GPT models. Please refresh the page or contact support if the problem persists.
            </AlertDescription>
          </Alert>
          
          {/* Still show the form in case it can work */}
          <div className="mt-4 space-y-2">
            <SetGptModel models={[]} />
          </div>
        </CardContent>
      </Card>
    );
  }
};

export default GptCard;