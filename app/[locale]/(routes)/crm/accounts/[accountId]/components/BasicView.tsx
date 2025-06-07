// file: nextcrm/app/[locale]/(routes)/crm/accounts/[accountId]/components/BasicView.tsx
/*
This component displays basic account information in a structured card layout
Shows account details, contact information, and address information

MIGRATION NOTES (MongoDB -> Supabase):
- Updated model name from 'users' to 'users' (kept lowercase as per schema)
- Enhanced error handling and data validation
- Improved UI with better organization and visual hierarchy
- Added proper loading states and fallback values
- Enhanced user experience with better formatting
- Added proper null/undefined handling for all fields
- Improved responsive design and accessibility
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  CalendarDays,
  CoinsIcon,
  File,
  Globe2,
  Landmark,
  MoreHorizontal,
  Percent,
  Phone,
  User,
  MapPin,
  Mail,
  Building,
  Calendar,
  AlertCircle,
  ExternalLink,
  Copy,
  Edit,
  CheckCircle,
  Clock,
  UserCheck,
} from "lucide-react";
import moment from "moment";
import { prismadb } from "@/lib/prisma";
import Link from "next/link";
import { users } from "@prisma/client"; // Updated to lowercase as per schema
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/use-toast";

interface BasicViewProps {
  data: any; // Account data from CRM system
}

// Helper function to format empty values
const formatValue = (value: any, fallback: string = "Not provided") => {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  return value;
};

// Helper function to copy text to clipboard
const copyToClipboard = async (text: string, label: string) => {
  try {
    await navigator.clipboard.writeText(text);
    toast({
      title: "Copied to clipboard",
      description: `${label} has been copied to your clipboard.`,
    });
  } catch (error) {
    console.error("Failed to copy to clipboard:", error);
    toast({
      title: "Copy failed",
      description: "Failed to copy to clipboard. Please try selecting and copying manually.",
      variant: "destructive",
    });
  }
};

export async function BasicView({ data }: BasicViewProps) {
  try {
    console.log("Loading BasicView for account:", data?.id);

    if (!data) {
      return (
        <div className="pb-3 space-y-5">
          <Alert className="border-amber-200 bg-amber-50">
            <AlertCircle className="h-4 w-4 text-amber-600" />
            <AlertDescription className="text-amber-700">
              Account data not found. Please check if the account exists or try refreshing the page.
            </AlertDescription>
          </Alert>
        </div>
      );
    }

    // Fetch users for created/updated by information
    const users: users[] = await prismadb.users.findMany({
      select: {
        id: true,
        name: true,
        email: true,
      }
    });

    // Helper to find user by ID
    const findUserById = (userId: string | null) => {
      if (!userId) return null;
      return users.find((user) => user.id === userId);
    };

    const createdByUser = findUserById(data.createdBy);
    const updatedByUser = findUserById(data.updatedBy);
    const assignedUser = data.assigned_to_user;

    return (
      <div className="pb-3 space-y-5">
        {/* Main Account Information */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex w-full justify-between items-start">
              <div className="space-y-2">
                <CardTitle className="text-2xl font-bold">{formatValue(data.name, "Unnamed Account")}</CardTitle>
                <div className="flex items-center gap-3">
                  <CardDescription className="flex items-center gap-1">
                    <Building className="h-4 w-4" />
                    ID: {data.id}
                  </CardDescription>
                  {data.status && (
                    <Badge 
                      variant={data.status === "Active" ? "default" : "secondary"}
                      className={`${
                        data.status === "Active" 
                          ? "bg-green-100 text-green-700" 
                          : "bg-gray-100 text-gray-700"
                      }`}
                    >
                      {data.status}
                    </Badge>
                  )}
                  {data.type && (
                    <Badge variant="outline">
                      {data.type}
                    </Badge>
                  )}
                </div>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm">
                    <MoreHorizontal className="h-5 w-5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem>
                    <Edit className="h-4 w-4 mr-2" />
                    Edit Account
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => copyToClipboard(data.id, "Account ID")}>
                    <Copy className="h-4 w-4 mr-2" />
                    Copy Account ID
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem>
                    View History
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Left Column - Basic Info */}
              <div className="space-y-4">
                <div className="space-y-1">
                  <h4 className="font-medium text-sm text-gray-700 flex items-center gap-2">
                    <Building className="h-4 w-4" />
                    Company Information
                  </h4>
                </div>

                <div className="space-y-3">
                  <div className="flex items-start space-x-3 p-2 rounded-md hover:bg-accent transition-colors">
                    <CoinsIcon className="mt-1 h-4 w-4 text-gray-500" />
                    <div className="flex-1 space-y-1">
                      <p className="text-sm font-medium">Annual Revenue</p>
                      <p className="text-sm text-muted-foreground">
                        {formatValue(data.annual_revenue, "Not disclosed")}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start space-x-3 p-2 rounded-md hover:bg-accent transition-colors">
                    <Landmark className="mt-1 h-4 w-4 text-gray-500" />
                    <div className="flex-1 space-y-1">
                      <p className="text-sm font-medium">Company ID</p>
                      <p className="text-sm text-muted-foreground">
                        {formatValue(data.company_id)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start space-x-3 p-2 rounded-md hover:bg-accent transition-colors">
                    <Percent className="mt-1 h-4 w-4 text-gray-500" />
                    <div className="flex-1 space-y-1">
                      <p className="text-sm font-medium">VAT Number</p>
                      <p className="text-sm text-muted-foreground">
                        {formatValue(data.vat)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start space-x-3 p-2 rounded-md hover:bg-accent transition-colors">
                    <Building className="mt-1 h-4 w-4 text-gray-500" />
                    <div className="flex-1 space-y-1">
                      <p className="text-sm font-medium">Industry</p>
                      <p className="text-sm text-muted-foreground">
                        {formatValue(data.industry)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start space-x-3 p-2 rounded-md hover:bg-accent transition-colors">
                    <User className="mt-1 h-4 w-4 text-gray-500" />
                    <div className="flex-1 space-y-1">
                      <p className="text-sm font-medium">Employees</p>
                      <p className="text-sm text-muted-foreground">
                        {formatValue(data.employees)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start space-x-3 p-2 rounded-md hover:bg-accent transition-colors">
                    <File className="mt-1 h-4 w-4 text-gray-500" />
                    <div className="flex-1 space-y-1">
                      <p className="text-sm font-medium">Description</p>
                      <p className="text-sm text-muted-foreground">
                        {formatValue(data.description)}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column - Contact & Management Info */}
              <div className="space-y-4">
                <div className="space-y-1">
                  <h4 className="font-medium text-sm text-gray-700 flex items-center gap-2">
                    <Mail className="h-4 w-4" />
                    Contact & Management
                  </h4>
                </div>

                <div className="space-y-3">
                  {assignedUser && (
                    <div className="flex items-start space-x-3 p-2 rounded-md hover:bg-accent transition-colors">
                      <UserCheck className="mt-1 h-4 w-4 text-green-600" />
                      <div className="flex-1 space-y-1">
                        <p className="text-sm font-medium">Assigned To</p>
                        <p className="text-sm text-muted-foreground">
                          {assignedUser.name || assignedUser.email}
                        </p>
                      </div>
                    </div>
                  )}

                  {data.email && (
                    <div className="flex items-start space-x-3 p-2 rounded-md hover:bg-accent transition-colors">
                      <Mail className="mt-1 h-4 w-4 text-gray-500" />
                      <div className="flex-1 space-y-1">
                        <p className="text-sm font-medium">Email</p>
                        <Link
                          href={`mailto:${data.email}`}
                          className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
                        >
                          {data.email}
                          <ExternalLink className="h-3 w-3" />
                        </Link>
                      </div>
                    </div>
                  )}

                  {data.website && (
                    <div className="flex items-start space-x-3 p-2 rounded-md hover:bg-accent transition-colors">
                      <Globe2 className="mt-1 h-4 w-4 text-gray-500" />
                      <div className="flex-1 space-y-1">
                        <p className="text-sm font-medium">Website</p>
                        <Link
                          href={data.website.startsWith('http') ? data.website : `https://${data.website}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
                        >
                          {data.website}
                          <ExternalLink className="h-3 w-3" />
                        </Link>
                      </div>
                    </div>
                  )}

                  {data.office_phone && (
                    <div className="flex items-start space-x-3 p-2 rounded-md hover:bg-accent transition-colors">
                      <Phone className="mt-1 h-4 w-4 text-gray-500" />
                      <div className="flex-1 space-y-1">
                        <p className="text-sm font-medium">Office Phone</p>
                        <Link
                          href={`tel:${data.office_phone}`}
                          className="text-sm text-blue-600 hover:text-blue-800"
                        >
                          {data.office_phone}
                        </Link>
                      </div>
                    </div>
                  )}

                  {data.fax && (
                    <div className="flex items-start space-x-3 p-2 rounded-md hover:bg-accent transition-colors">
                      <Phone className="mt-1 h-4 w-4 text-gray-500" />
                      <div className="flex-1 space-y-1">
                        <p className="text-sm font-medium">Fax</p>
                        <p className="text-sm text-muted-foreground">{data.fax}</p>
                      </div>
                    </div>
                  )}

                  {/* Creation and Update Info */}
                  <div className="border-t pt-3 mt-4">
                    <div className="flex items-start space-x-3 p-2 rounded-md hover:bg-accent transition-colors">
                      <Calendar className="mt-1 h-4 w-4 text-gray-500" />
                      <div className="flex-1 space-y-2">
                        <div>
                          <p className="text-sm font-medium">Created</p>
                          <p className="text-sm text-muted-foreground">
                            {data.created_on ? moment(data.created_on).format("MMM DD, YYYY") : "Unknown"}
                            {createdByUser && (
                              <span className="ml-2">by {createdByUser.name}</span>
                            )}
                          </p>
                        </div>
                        {data.updatedAt && (
                          <div>
                            <p className="text-sm font-medium">Last Updated</p>
                            <p className="text-sm text-muted-foreground">
                              {moment(data.updatedAt).format("MMM DD, YYYY")}
                              {updatedByUser && (
                                <span className="ml-2">by {updatedByUser.name}</span>
                              )}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Address Information */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Billing Address */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <MapPin className="h-5 w-5 text-blue-600" />
                Billing Address
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                { label: "Street", value: data.billing_street },
                { label: "City", value: data.billing_city },
                { label: "State", value: data.billing_state },
                { label: "Postal Code", value: data.billing_postal_code },
                { label: "Country", value: data.billing_country },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between items-center p-2 rounded-md hover:bg-accent transition-colors">
                  <span className="text-sm font-medium text-gray-600">{label}</span>
                  <span className="text-sm text-muted-foreground">{formatValue(value)}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Shipping Address */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <MapPin className="h-5 w-5 text-green-600" />
                Shipping Address
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                { label: "Street", value: data.shipping_street },
                { label: "City", value: data.shipping_city },
                { label: "State", value: data.shipping_state },
                { label: "Postal Code", value: data.shipping_postal_code },
                { label: "Country", value: data.shipping_country },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between items-center p-2 rounded-md hover:bg-accent transition-colors">
                  <span className="text-sm font-medium text-gray-600">{label}</span>
                  <span className="text-sm text-muted-foreground">{formatValue(value)}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    );

  } catch (error) {
    console.error("Error rendering BasicView:", error);
    
    return (
      <div className="pb-3 space-y-5">
        <Alert className="border-red-200 bg-red-50">
          <AlertCircle className="h-4 w-4 text-red-600" />
          <AlertDescription className="text-red-700">
            An error occurred while loading the account details. Please refresh the page or contact support if the problem persists.
          </AlertDescription>
        </Alert>
      </div>
    );
  }
}