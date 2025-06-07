// file: nextcrm/app/[locale]/(routes)/crm/contacts/[contactId]/components/BasicView.tsx
/*
This component displays detailed contact information in a structured layout
Shows contact details, communication channels, social media, and notes

MIGRATION NOTES (MongoDB -> Supabase):
- Updated model name from 'users' to 'users' (kept lowercase as per schema)
- Enhanced error handling and data validation
- Improved UI with better organization and visual hierarchy
- Added proper loading states and fallback values
- Enhanced user experience with better contact information display
- Added proper null/undefined handling for all fields
- Improved responsive design and accessibility
- Added copy functionality and better interaction patterns
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
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/use-toast";

import {
  CalendarDays,
  User,
  Building,
  Phone,
  Mail,
  Globe,
  MapPin,
  Briefcase,
  Calendar,
  Tag,
  FileText,
  MoreHorizontal,
  Edit,
  Copy,
  ExternalLink,
  AlertCircle,
  CheckCircle,
  Clock,
  UserCheck,
  MessageSquare,
  Share2,
} from "lucide-react";
import {
  Twitter,
  Facebook,
  Instagram,
  Linkedin,
  Youtube,
} from "lucide-react";
import moment from "moment";
import { prismadb } from "@/lib/prisma";
import Link from "next/link";
import { users } from "@prisma/client"; // Updated to lowercase as per schema

interface ContactBasicViewProps {
  data: any; // Contact data from CRM system
}

// Helper function to format empty values
const formatValue = (value: any, fallback: string = "Not provided") => {
  if (value === null || value === undefined || value === "" || value === "N/A") {
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

// Helper function to get social media icon
const getSocialIcon = (platform: string) => {
  const iconMap: { [key: string]: React.ComponentType<{ className?: string }> } = {
    twitter: Twitter,
    facebook: Facebook,
    linkedin: Linkedin,
    instagram: Instagram,
    youtube: Youtube,
  };
  return iconMap[platform.toLowerCase()] || MessageSquare;
};

export async function BasicView({ data }: ContactBasicViewProps) {
  try {
    console.log("Loading BasicView for contact:", data?.id);

    if (!data) {
      return (
        <div className="pb-3 space-y-5">
          <Alert className="border-amber-200 bg-amber-50">
            <AlertCircle className="h-4 w-4 text-amber-600" />
            <AlertDescription className="text-amber-700">
              Contact data not found. Please check if the contact exists or try refreshing the page.
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
    const assignedUser = findUserById(data.assigned_to);

    // Social media platforms with data
    const socialPlatforms = [
      { name: 'Twitter', value: data.social_twitter, icon: Twitter, color: 'text-blue-400' },
      { name: 'Facebook', value: data.social_facebook, icon: Facebook, color: 'text-blue-600' },
      { name: 'LinkedIn', value: data.social_linkedin, icon: Linkedin, color: 'text-blue-700' },
      { name: 'Instagram', value: data.social_instagram, icon: Instagram, color: 'text-pink-600' },
      { name: 'YouTube', value: data.social_youtube, icon: Youtube, color: 'text-red-600' },
      { name: 'TikTok', value: data.social_tiktok, icon: MessageSquare, color: 'text-gray-600' },
      { name: 'Skype', value: data.social_skype, icon: MessageSquare, color: 'text-blue-500' },
    ].filter(platform => platform.value && platform.value !== "");

    return (
      <div className="pb-3 space-y-6">
        {/* Main Contact Information */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex w-full justify-between items-start">
              <div className="space-y-2">
                <CardTitle className="text-2xl font-bold flex items-center gap-3">
                  <User className="h-6 w-6 text-blue-600" />
                  {formatValue(`${data.first_name || ''} ${data.last_name || ''}`.trim(), "Unnamed Contact")}
                </CardTitle>
                <div className="flex items-center gap-3">
                  <CardDescription className="flex items-center gap-1">
                    ID: {data.id}
                  </CardDescription>
                  <Badge 
                    variant={data.status ? "default" : "secondary"}
                    className={`${
                      data.status 
                        ? "bg-green-100 text-green-700" 
                        : "bg-gray-100 text-gray-700"
                    }`}
                  >
                    {data.status ? "Active" : "Inactive"}
                  </Badge>
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
                    Edit Contact
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => copyToClipboard(data.id, "Contact ID")}>
                    <Copy className="h-4 w-4 mr-2" />
                    Copy Contact ID
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem>
                    <Share2 className="h-4 w-4 mr-2" />
                    Share Contact
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Left Column - Professional Info */}
              <div className="space-y-4">
                <div className="space-y-1">
                  <h4 className="font-medium text-sm text-gray-700 flex items-center gap-2">
                    <Briefcase className="h-4 w-4" />
                    Professional Information
                  </h4>
                </div>

                <div className="space-y-3">
                  <div className="flex items-start space-x-3 p-2 rounded-md hover:bg-accent transition-colors">
                    <Building className="mt-1 h-4 w-4 text-gray-500" />
                    <div className="flex-1 space-y-1">
                      <p className="text-sm font-medium">Account</p>
                      <p className="text-sm text-muted-foreground">
                        {formatValue(data.assigned_accounts?.name)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start space-x-3 p-2 rounded-md hover:bg-accent transition-colors">
                    <Briefcase className="mt-1 h-4 w-4 text-gray-500" />
                    <div className="flex-1 space-y-1">
                      <p className="text-sm font-medium">Position</p>
                      <p className="text-sm text-muted-foreground">
                        {formatValue(data.position)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start space-x-3 p-2 rounded-md hover:bg-accent transition-colors">
                    <Calendar className="mt-1 h-4 w-4 text-gray-500" />
                    <div className="flex-1 space-y-1">
                      <p className="text-sm font-medium">Birthday</p>
                      <p className="text-sm text-muted-foreground">
                        {data.birthday 
                          ? moment(data.birthday).format("MMM DD, YYYY")
                          : "Not provided"
                        }
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start space-x-3 p-2 rounded-md hover:bg-accent transition-colors">
                    <FileText className="mt-1 h-4 w-4 text-gray-500" />
                    <div className="flex-1 space-y-1">
                      <p className="text-sm font-medium">Description</p>
                      <p className="text-sm text-muted-foreground">
                        {formatValue(data.description)}
                      </p>
                    </div>
                  </div>

                  {/* Tags */}
                  {data.tags && data.tags.length > 0 && (
                    <div className="flex items-start space-x-3 p-2 rounded-md hover:bg-accent transition-colors">
                      <Tag className="mt-1 h-4 w-4 text-gray-500" />
                      <div className="flex-1 space-y-2">
                        <p className="text-sm font-medium">Tags</p>
                        <div className="flex flex-wrap gap-2">
                          {data.tags.map((tag: string, index: number) => (
                            <Badge key={index} variant="outline" className="text-xs">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column - Management Info */}
              <div className="space-y-4">
                <div className="space-y-1">
                  <h4 className="font-medium text-sm text-gray-700 flex items-center gap-2">
                    <UserCheck className="h-4 w-4" />
                    Management & Timeline
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

                  <div className="flex items-start space-x-3 p-2 rounded-md hover:bg-accent transition-colors">
                    <CheckCircle className="mt-1 h-4 w-4 text-blue-600" />
                    <div className="flex-1 space-y-1">
                      <p className="text-sm font-medium">Status</p>
                      <div className="flex items-center gap-2">
                        <Badge 
                          variant={data.status ? "default" : "secondary"}
                          className={`text-xs ${
                            data.status 
                              ? "bg-green-100 text-green-700" 
                              : "bg-gray-100 text-gray-700"
                          }`}
                        >
                          {data.status ? "Active" : "Inactive"}
                        </Badge>
                        {data.type && (
                          <Badge variant="outline" className="text-xs">
                            {data.type}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Creation and Update Info */}
                  <div className="border-t pt-3 mt-4 space-y-3">
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

        {/* Contact Information and Social Media */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Contact Information */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Mail className="h-5 w-5 text-blue-600" />
                Contact Information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Email */}
              {data.email && (
                <div className="flex items-center justify-between p-2 rounded-md hover:bg-accent transition-colors">
                  <div className="flex items-center gap-3">
                    <Mail className="h-4 w-4 text-gray-500" />
                    <div>
                      <p className="text-sm font-medium">Business Email</p>
                      <Link
                        href={`mailto:${data.email}`}
                        className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
                      >
                        {data.email}
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                    </div>
                  </div>
                </div>
              )}

              {/* Personal Email */}
              {data.personal_email && (
                <div className="flex items-center justify-between p-2 rounded-md hover:bg-accent transition-colors">
                  <div className="flex items-center gap-3">
                    <Mail className="h-4 w-4 text-gray-500" />
                    <div>
                      <p className="text-sm font-medium">Personal Email</p>
                      <Link
                        href={`mailto:${data.personal_email}`}
                        className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
                      >
                        {data.personal_email}
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                    </div>
                  </div>
                </div>
              )}

              {/* Office Phone */}
              {data.office_phone && (
                <div className="flex items-center justify-between p-2 rounded-md hover:bg-accent transition-colors">
                  <div className="flex items-center gap-3">
                    <Phone className="h-4 w-4 text-gray-500" />
                    <div>
                      <p className="text-sm font-medium">Office Phone</p>
                      <Link
                        href={`tel:${data.office_phone}`}
                        className="text-sm text-blue-600 hover:text-blue-800"
                      >
                        {data.office_phone}
                      </Link>
                    </div>
                  </div>
                </div>
              )}

              {/* Mobile Phone */}
              {data.mobile_phone && (
                <div className="flex items-center justify-between p-2 rounded-md hover:bg-accent transition-colors">
                  <div className="flex items-center gap-3">
                    <Phone className="h-4 w-4 text-gray-500" />
                    <div>
                      <p className="text-sm font-medium">Mobile Phone</p>
                      <Link
                        href={`tel:${data.mobile_phone}`}
                        className="text-sm text-blue-600 hover:text-blue-800"
                      >
                        {data.mobile_phone}
                      </Link>
                    </div>
                  </div>
                </div>
              )}

              {/* Website */}
              {data.website && (
                <div className="flex items-center justify-between p-2 rounded-md hover:bg-accent transition-colors">
                  <div className="flex items-center gap-3">
                    <Globe className="h-4 w-4 text-gray-500" />
                    <div>
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
                </div>
              )}
            </CardContent>
          </Card>

          {/* Social Media */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Share2 className="h-5 w-5 text-purple-600" />
                Social Networks
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {socialPlatforms.length > 0 ? (
                socialPlatforms.map((platform) => {
                  const IconComponent = platform.icon;
                  return (
                    <div key={platform.name} className="flex items-center justify-between p-2 rounded-md hover:bg-accent transition-colors">
                      <div className="flex items-center gap-3">
                        <IconComponent className={`h-4 w-4 ${platform.color}`} />
                        <div>
                          <p className="text-sm font-medium">{platform.name}</p>
                          <p className="text-sm text-muted-foreground">
                            {platform.value}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="text-center py-4">
                  <Share2 className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No social media profiles</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Notes Section */}
        {data.notes && data.notes.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <FileText className="h-5 w-5 text-green-600" />
                Notes
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {data.notes.map((note: string, index: number) => (
                  <div key={index} className="p-3 bg-gray-50 rounded-md border-l-4 border-blue-500">
                    <p className="text-sm text-gray-700">{note}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    );

  } catch (error) {
    console.error("Error rendering Contact BasicView:", error);
    
    return (
      <div className="pb-3 space-y-5">
        <Alert className="border-red-200 bg-red-50">
          <AlertCircle className="h-4 w-4 text-red-600" />
          <AlertDescription className="text-red-700">
            An error occurred while loading the contact details. Please refresh the page or contact support if the problem persists.
          </AlertDescription>
        </Alert>
      </div>
    );
  }
}