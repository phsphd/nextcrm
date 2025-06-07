// file: nextcrm/app/[locale]/(routes)/admin/forms/SetGptModel.tsx
/*
This component handles GPT model selection and activation for the AI assistant
Allows administrators to choose which GPT model should be active

MIGRATION NOTES (MongoDB -> Supabase):
- Updated Prisma type import from 'gpt_models' to 'gpt_models' (kept lowercase as per schema)
- Enhanced form validation and error handling
- Improved UI with better status indicators and model information
- Added model status management and better user feedback
- Enhanced loading states and error handling
- Added model descriptions and better selection interface
*/
"use client";

import Link from "next/link";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "@/components/ui/use-toast";
import updateModel from "@/actions/admin/update-gpt-model";
import { useRouter } from "next/navigation";
import { gpt_models } from "@prisma/client"; // Updated to lowercase as per schema
import { Bot, CheckCircle, Clock, AlertCircle, Loader2 } from "lucide-react";

// Enhanced form schema with better validation
const FormSchema = z.object({
  model: z.string()
    .min(1, "Please select a GPT model")
    .regex(/^[a-zA-Z0-9\-_]+$/, "Invalid model ID format")
});

interface SetGptModelProps {
  models: gpt_models[];
}

const SetGptModel = ({ models }: SetGptModelProps) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selectedModelId, setSelectedModelId] = useState<string>("");

  // Find currently active model
  const activeModel = models.find(model => model.status === "ACTIVE");
  const availableModels = models.filter(model => model.status === "INACTIVE");

  const form = useForm<z.infer<typeof FormSchema>>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      model: activeModel?.id || "",
    },
  });

  async function onSubmit(data: z.infer<typeof FormSchema>) {
    if (!data.model) {
      toast({
        title: "Selection Required",
        description: "Please select a GPT model to activate.",
        variant: "destructive",
      });
      return;
    }

    const selectedModel = models.find(model => model.id === data.model);
    if (!selectedModel) {
      toast({
        title: "Invalid Selection",
        description: "Selected model not found.",
        variant: "destructive",
      });
      return;
    }

    startTransition(async () => {
      try {
        console.log(`Updating GPT model to: ${selectedModel.model}`);
        
        await updateModel(data.model);
        
        toast({
          title: "GPT Model Updated",
          description: `Successfully activated ${selectedModel.model} for AI assistant.`,
        });

        // Reset form to new active model
        form.setValue("model", data.model);
        
      } catch (error) {
        console.error("Error updating GPT model:", error);
        
        toast({
          title: "Update Failed",
          description: "Failed to update GPT model. Please try again.",
          variant: "destructive",
        });
      } finally {
        router.refresh();
      }
    });
  }

  // Handle selection change for preview
  const handleModelChange = (modelId: string) => {
    setSelectedModelId(modelId);
    form.setValue("model", modelId);
  };

  // Get model details for display
  const getModelDetails = (modelId: string) => {
    return models.find(model => model.id === modelId);
  };

  const selectedModel = selectedModelId ? getModelDetails(selectedModelId) : activeModel;

  if (!models || models.length === 0) {
    return (
      <Alert className="border-amber-200 bg-amber-50">
        <AlertCircle className="h-4 w-4 text-amber-600" />
        <AlertDescription className="text-amber-700">
          No GPT models configured. Please add models to enable AI assistant features.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      {/* Current Status */}
      {activeModel && (
        <div className="flex items-center gap-2 p-3 bg-green-50 rounded-lg border border-green-200">
          <CheckCircle className="h-4 w-4 text-green-600" />
          <span className="text-sm text-green-700">
            Current active model: <span className="font-medium">{activeModel.model}</span>
          </span>
        </div>
      )}

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            control={form.control}
            name="model"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="flex items-center gap-2">
                  <Bot className="h-4 w-4" />
                  Select GPT Model
                </FormLabel>
                
                <Select 
                  onValueChange={handleModelChange} 
                  defaultValue={activeModel?.id || ""}
                  disabled={isPending}
                >
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Choose a GPT model for AI assistant" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {models.map((model: gpt_models) => (
                      <SelectItem key={model.id} value={model.id}>
                        <div className="flex items-center justify-between w-full">
                          <span className="font-medium">{model.model}</span>
                          <div className="flex items-center gap-2 ml-2">
                            {model.status === "ACTIVE" && (
                              <Badge variant="secondary" className="bg-green-100 text-green-700 text-xs">
                                <CheckCircle className="h-3 w-3 mr-1" />
                                Active
                              </Badge>
                            )}
                            {model.status === "INACTIVE" && (
                              <Badge variant="secondary" className="bg-gray-100 text-gray-700 text-xs">
                                <Clock className="h-3 w-3 mr-1" />
                                Inactive
                              </Badge>
                            )}
                          </div>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <FormDescription>
                  Select which GPT model should be active for AI assistant features
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Model Preview */}
          {selectedModel && (
            <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
              <div className="flex items-center gap-2 mb-2">
                <Bot className="h-4 w-4 text-blue-600" />
                <span className="font-medium text-blue-900">Selected Model Details</span>
              </div>
              <div className="text-sm text-blue-700 space-y-1">
                <div className="flex justify-between">
                  <span>Model:</span>
                  <span className="font-medium">{selectedModel.model}</span>
                </div>
                <div className="flex justify-between">
                  <span>Status:</span>
                  <Badge 
                    variant="secondary" 
                    className={`text-xs ${
                      selectedModel.status === "ACTIVE" 
                        ? "bg-green-100 text-green-700" 
                        : "bg-gray-100 text-gray-700"
                    }`}
                  >
                    {selectedModel.status}
                  </Badge>
                </div>
                {selectedModel.description && (
                  <div className="flex justify-between">
                    <span>Description:</span>
                    <span className="font-medium">{selectedModel.description}</span>
                  </div>
                )}
                {selectedModel.created_on && (
                  <div className="flex justify-between">
                    <span>Created:</span>
                    <span className="font-medium">
                      {new Date(selectedModel.created_on).toLocaleDateString()}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-2 justify-end">
            <Button 
              type="button" 
              variant="outline" 
              onClick={() => {
                form.reset();
                setSelectedModelId("");
              }}
              disabled={isPending}
            >
              Reset
            </Button>
            
            <Button 
              type="submit" 
              disabled={isPending || !selectedModelId || selectedModelId === activeModel?.id}
            >
              {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {isPending ? "Updating..." : "Activate Model"}
            </Button>
          </div>

          {/* Warning for model change */}
          {selectedModelId && selectedModelId !== activeModel?.id && (
            <Alert className="border-amber-200 bg-amber-50">
              <AlertCircle className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-amber-700 text-sm">
                Changing the active model will affect all AI assistant features across the system.
                The change will take effect immediately.
              </AlertDescription>
            </Alert>
          )}
        </form>
      </Form>

      {/* Model Statistics */}
      {models.length > 0 && (
        <div className="border-t pt-4">
          <div className="text-xs text-gray-600 space-y-1">
            <div className="flex justify-between">
              <span>Total models:</span>
              <span className="font-medium">{models.length}</span>
            </div>
            <div className="flex justify-between">
              <span>Active models:</span>
              <span className="font-medium text-green-600">
                {models.filter(m => m.status === "ACTIVE").length}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Available models:</span>
              <span className="font-medium text-blue-600">
                {models.filter(m => m.status === "INACTIVE").length}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SetGptModel;