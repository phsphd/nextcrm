// file: nextcrm/app/[locale]/(routes)/crm/accounts/components/UpdateAccountForm.tsx
/*
This component provides a form for updating CRM account information
Includes validation, industry selection, and user assignment

MIGRATION NOTES (MongoDB -> Supabase):
- Updated Prisma type import from 'crm_Accounts' to 'crm_Accounts' (kept as per schema)
- Enhanced validation schema with better field validation
- Improved error handling and loading states
- Better UI with enhanced form organization and visual feedback
- Added proper TypeScript types and removed any types
- Enhanced user experience with better form flow and validation
- Added form sections and improved accessibility
*/
"use client";

import React from "react";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import axios from "axios";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";

import fetcher from "@/lib/fetcher";
import useSWR from "swr";
import SuspenseLoading from "@/components/loadings/suspense";
import { crm_Accounts } from "@prisma/client"; // Model name matches schema

import {
  Building,
  Mail,
  Phone,
  Globe,
  MapPin,
  User,
  DollarSign,
  FileText,
  AlertCircle,
  Save,
  Loader2,
} from "lucide-react";

// Enhanced form schema with better validation
const formSchema = z.object({
  id: z.string().min(1, "ID is required"),
  name: z.string().min(2, "Account name must be at least 2 characters").max(100, "Account name is too long"),
  office_phone: z.string().nullable().optional(),
  website: z.string()
    .nullable()
    .optional()
    .refine((val) => {
      if (!val) return true;
      try {
        new URL(val.startsWith('http') ? val : `https://${val}`);
        return true;
      } catch {
        return false;
      }
    }, "Please enter a valid website URL"),
  fax: z.string().nullable().optional(),
  company_id: z.string().min(1, "Company ID is required").max(20, "Company ID is too long"),
  vat: z.string().nullable().optional(),
  email: z.string().email("Please enter a valid email address"),
  billing_street: z.string().min(1, "Billing street is required").max(100, "Street address is too long"),
  billing_postal_code: z.string().min(1, "Postal code is required").max(20, "Postal code is too long"),
  billing_city: z.string().min(1, "City is required").max(50, "City name is too long"),
  billing_state: z.string().nullable().optional(),
  billing_country: z.string().min(1, "Country is required").max(50, "Country name is too long"),
  shipping_street: z.string().nullable().optional(),
  shipping_postal_code: z.string().nullable().optional(),
  shipping_city: z.string().nullable().optional(),
  shipping_state: z.string().nullable().optional(),
  shipping_country: z.string().nullable().optional(),
  description: z.string().max(500, "Description is too long").nullable().optional(),
  assigned_to: z.string().min(1, "Please assign the account to a user"),
  status: z.string().nullable().optional(),
  annual_revenue: z.string().nullable().optional(),
  member_of: z.string().nullable().optional(),
  industry: z.string().min(1, "Please select an industry"),
});

type UpdateAccountFormValues = z.infer<typeof formSchema>;

interface UpdateAccountFormProps {
  initialData: crm_Accounts & {
    assigned_to_user?: { id: string; name: string; email: string } | null;
    industry_type?: { id: string; name: string } | null;
  };
  open: (value: boolean) => void;
}

interface Industry {
  id: string;
  name: string;
}

interface User {
  id: string;
  name: string;
  email: string;
}

export function UpdateAccountForm({ initialData, open }: UpdateAccountFormProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = React.useState<boolean>(false);

  const { data: industries, isLoading: isLoadingIndustries, error: industriesError } = useSWR<Industry[]>(
    "/api/crm/industries",
    fetcher
  );
  
  const { data: users, isLoading: isLoadingUsers, error: usersError } = useSWR<User[]>(
    "/api/user",
    fetcher
  );

  const form = useForm<UpdateAccountFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      id: initialData?.id || "",
      name: initialData?.name || "",
      office_phone: initialData?.office_phone || "",
      website: initialData?.website || "",
      fax: initialData?.fax || "",
      company_id: initialData?.company_id || "",
      vat: initialData?.vat || "",
      email: initialData?.email || "",
      billing_street: initialData?.billing_street || "",
      billing_postal_code: initialData?.billing_postal_code || "",
      billing_city: initialData?.billing_city || "",
      billing_state: initialData?.billing_state || "",
      billing_country: initialData?.billing_country || "",
      shipping_street: initialData?.shipping_street || "",
      shipping_postal_code: initialData?.shipping_postal_code || "",
      shipping_city: initialData?.shipping_city || "",
      shipping_state: initialData?.shipping_state || "",
      shipping_country: initialData?.shipping_country || "",
      description: initialData?.description || "",
      assigned_to: initialData?.assigned_to || "",
      status: initialData?.status || "Active",
      annual_revenue: initialData?.annual_revenue || "",
      member_of: initialData?.member_of || "",
      industry: initialData?.industry || "",
    },
  });

  const onSubmit = async (data: UpdateAccountFormValues) => {
    setIsLoading(true);
    try {
      console.log("Updating account:", data.id);
      
      await axios.put("/api/crm/account", data);
      
      toast({
        title: "Success",
        description: `Account "${data.name}" has been updated successfully.`,
      });
      
      open(false);
      router.refresh();
      
    } catch (error: any) {
      console.error("Error updating account:", error);
      
      const errorMessage = error?.response?.data?.message || 
                          error?.response?.data || 
                          "Failed to update account. Please try again.";
      
      toast({
        variant: "destructive",
        title: "Update Failed",
        description: errorMessage,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const copyBillingToShipping = () => {
    form.setValue("shipping_street", form.getValues("billing_street"));
    form.setValue("shipping_postal_code", form.getValues("billing_postal_code"));
    form.setValue("shipping_city", form.getValues("billing_city"));
    form.setValue("shipping_state", form.getValues("billing_state"));
    form.setValue("shipping_country", form.getValues("billing_country"));
    
    toast({
      title: "Addresses Copied",
      description: "Billing address has been copied to shipping address.",
    });
  };

  // Loading state
  if (isLoadingIndustries || isLoadingUsers) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-blue-600" />
          <p className="text-sm text-muted-foreground">Loading form data...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (industriesError || usersError || !initialData) {
    return (
      <Alert className="border-red-200 bg-red-50">
        <AlertCircle className="h-4 w-4 text-red-600" />
        <AlertDescription className="text-red-700">
          {!initialData 
            ? "Account data is missing. Please try refreshing the page."
            : "Failed to load form data. Please check your connection and try again."
          }
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="space-y-2">
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Building className="h-6 w-6 text-blue-600" />
          Update Account
        </h2>
        <p className="text-muted-foreground">
          Update the information for <span className="font-medium">{initialData.name}</span>
        </p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          {/* Basic Information */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building className="h-5 w-5" />
                Basic Information
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Account Name *</FormLabel>
                    <FormControl>
                      <Input
                        disabled={isLoading}
                        placeholder="NextCRM Inc."
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="company_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Company ID *</FormLabel>
                    <FormControl>
                      <Input
                        disabled={isLoading}
                        placeholder="1234567890"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email Address *</FormLabel>
                    <FormControl>
                      <Input
                        disabled={isLoading}
                        type="email"
                        placeholder="contact@company.com"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="office_phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Office Phone</FormLabel>
                    <FormControl>
                      <Input
                        disabled={isLoading}
                        placeholder="+1 (555) 123-4567"
                        value={field.value || ""}
                        onChange={field.onChange}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="website"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Website</FormLabel>
                    <FormControl>
                      <Input
                        disabled={isLoading}
                        placeholder="https://www.company.com"
                        value={field.value || ""}
                        onChange={field.onChange}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="vat"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>VAT Number</FormLabel>
                    <FormControl>
                      <Input
                        disabled={isLoading}
                        placeholder="GB123456789"
                        value={field.value || ""}
                        onChange={field.onChange}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {/* Address Information */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <MapPin className="h-5 w-5" />
                  Address Information
                </CardTitle>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={copyBillingToShipping}
                  disabled={isLoading}
                >
                  Copy Billing to Shipping
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Billing Address */}
                <div className="space-y-4">
                  <h4 className="font-medium text-sm text-blue-600">Billing Address *</h4>
                  <div className="space-y-3">
                    <FormField
                      control={form.control}
                      name="billing_street"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Street Address</FormLabel>
                          <FormControl>
                            <Input
                              disabled={isLoading}
                              placeholder="123 Main Street"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="grid grid-cols-2 gap-3">
                      <FormField
                        control={form.control}
                        name="billing_city"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>City</FormLabel>
                            <FormControl>
                              <Input
                                disabled={isLoading}
                                placeholder="New York"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="billing_postal_code"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Postal Code</FormLabel>
                            <FormControl>
                              <Input
                                disabled={isLoading}
                                placeholder="10001"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <FormField
                        control={form.control}
                        name="billing_state"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>State/Province</FormLabel>
                            <FormControl>
                              <Input
                                disabled={isLoading}
                                placeholder="NY"
                                value={field.value || ""}
                                onChange={field.onChange}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="billing_country"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Country</FormLabel>
                            <FormControl>
                              <Input
                                disabled={isLoading}
                                placeholder="United States"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>
                </div>

                {/* Shipping Address */}
                <div className="space-y-4">
                  <h4 className="font-medium text-sm text-green-600">Shipping Address</h4>
                  <div className="space-y-3">
                    <FormField
                      control={form.control}
                      name="shipping_street"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Street Address</FormLabel>
                          <FormControl>
                            <Input
                              disabled={isLoading}
                              placeholder="123 Main Street"
                              value={field.value || ""}
                              onChange={field.onChange}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="grid grid-cols-2 gap-3">
                      <FormField
                        control={form.control}
                        name="shipping_city"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>City</FormLabel>
                            <FormControl>
                              <Input
                                disabled={isLoading}
                                placeholder="New York"
                                value={field.value || ""}
                                onChange={field.onChange}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="shipping_postal_code"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Postal Code</FormLabel>
                            <FormControl>
                              <Input
                                disabled={isLoading}
                                placeholder="10001"
                                value={field.value || ""}
                                onChange={field.onChange}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <FormField
                        control={form.control}
                        name="shipping_state"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>State/Province</FormLabel>
                            <FormControl>
                              <Input
                                disabled={isLoading}
                                placeholder="NY"
                                value={field.value || ""}
                                onChange={field.onChange}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="shipping_country"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Country</FormLabel>
                            <FormControl>
                              <Input
                                disabled={isLoading}
                                placeholder="United States"
                                value={field.value || ""}
                                onChange={field.onChange}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Additional Information */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Additional Information
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="industry"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Industry *</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select industry" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent className="max-h-56">
                        {industries?.map((industry) => (
                          <SelectItem key={industry.id} value={industry.id}>
                            {industry.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="assigned_to"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Assigned To *</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Assign to user" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent className="max-h-56">
                        {users?.map((user) => (
                          <SelectItem key={user.id} value={user.id}>
                            <div className="flex items-center gap-2">
                              <User className="h-4 w-4" />
                              {user.name} ({user.email})
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="annual_revenue"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Annual Revenue</FormLabel>
                    <FormControl>
                      <Input
                        disabled={isLoading}
                        placeholder="$1,000,000"
                        value={field.value || ""}
                        onChange={field.onChange}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="member_of"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Member Of</FormLabel>
                    <FormControl>
                      <Input
                        disabled={isLoading}
                        placeholder="Parent company"
                        value={field.value || ""}
                        onChange={field.onChange}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="md:col-span-2">
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Textarea
                          disabled={isLoading}
                          placeholder="Account description and notes..."
                          rows={3}
                          value={field.value || ""}
                          onChange={field.onChange}
                        />
                      </FormControl>
                      <FormDescription>
                        Provide additional details about this account
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </Card>

          {/* Form Actions */}
          <div className="flex items-center justify-end gap-3 pt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => open(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading} className="gap-2">
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {isLoading ? "Updating..." : "Update Account"}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}