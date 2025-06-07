// file: nextcrm/app/[locale]/(auth)/pending/page.tsx
/*
This page displays when a user account is pending admin approval
Shows admin contact information for account approval requests

MIGRATION NOTES (MongoDB -> Supabase):
- Updated Prisma type import from 'Users' to 'users' (lowercase as per schema)
- Enhanced error handling and data validation
- Improved UI with better responsive design and professional appearance
- Added proper loading states and error boundaries
- Enhanced security with user status validation
- Better email formatting and contact options
- Removed user ID display for security reasons
- Added proper card layout and improved styling
- Fixed Next.js Image optimization warning
- Fixed unescaped entities errors
*/
import { Button } from "@/components/ui/button";
import { authOptions } from "@/lib/auth";
import { prismadb } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import TryAgain from "./components/TryAgain";
import { users } from "@prisma/client"; // Updated to lowercase 'users' as per schema
import {
  Card,
  CardContent,
  CardDescription,
  CardTitle,
  CardHeader,
} from "@/components/ui/card";
import { Clock, User, Mail, Shield, CheckCircle } from "lucide-react";

const PendingPage = async () => {
  try {
    console.log("Loading pending page - checking admin users...");

    // Get current session
    const session = await getServerSession(authOptions);

    // Redirect if user is not pending
    if (!session) {
      console.log("No session found, redirecting to sign-in");
      return redirect("/sign-in");
    }

    if (session.user?.userStatus !== "PENDING") {
      console.log(`User status is ${session.user?.userStatus}, redirecting to home`);
      return redirect("/");
    }

    // Fetch active admin users for contact information
    const adminUsers: users[] = await prismadb.users.findMany({
      where: {
        is_admin: true,
        userStatus: "ACTIVE",
      },
      select: {
        id: true,
        name: true,
        email: true,
        avatar: true,
        is_account_admin: true,
        // Don't select sensitive fields
      },
      orderBy: [
        { is_account_admin: 'desc' }, // Account admins first
        { name: 'asc' } // Then alphabetical
      ]
    });

    console.log(`Found ${adminUsers.length} active admin users`);

    // If no admin users found, show error state
    if (!adminUsers || adminUsers.length === 0) {
      return (
        <div className="min-h-screen flex items-center justify-center p-4">
          <Card className="w-full max-w-2xl">
            <CardHeader className="text-center">
              <div className="flex justify-center mb-4">
                <div className="rounded-full bg-yellow-100 p-3">
                  <Clock className="h-8 w-8 text-yellow-600" />
                </div>
              </div>
              <CardTitle className="text-2xl text-yellow-600">
                Account Pending Approval
              </CardTitle>
              <CardDescription>
                Your account is awaiting approval, but no active administrators were found. 
                Please contact your system administrator directly or reach out to technical support.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-center">
              <Button asChild>
                <Link href="/sign-in">Sign in with another account</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      );
    }

    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gray-50">
        <Card className="w-full max-w-4xl shadow-lg">
          <CardHeader className="text-center border-b">
            <div className="flex justify-center mb-4">
              <div className="rounded-full bg-yellow-100 p-3">
                <Clock className="h-8 w-8 text-yellow-600" />
              </div>
            </div>
            <CardTitle className="text-2xl font-bold text-gray-900">
              Account Pending Approval
            </CardTitle>
            <CardDescription className="text-lg mt-2 max-w-2xl mx-auto">
              Welcome to {process.env.NEXT_PUBLIC_APP_NAME || 'NextCRM'}! Your account has been created successfully 
              and is now awaiting approval from an administrator. Please contact one of the administrators 
              below to request account activation.
            </CardDescription>
          </CardHeader>

          <CardContent className="p-6">
            {/* Status Message */}
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
              <div className="flex items-start space-x-3">
                <CheckCircle className="h-5 w-5 text-yellow-600 mt-0.5 flex-shrink-0" />
                <div>
                  <h3 className="font-medium text-yellow-800">What&apos;s Next?</h3>
                  <p className="text-yellow-700 text-sm mt-1">
                    {adminUsers.length === 1 ? 'An administrator' : 'One of the administrators listed below'} needs to approve your account. 
                    If you&apos;re the first user in your organization, please contact technical support for initial setup.
                  </p>
                </div>
              </div>
            </div>

            {/* Admin Contact Section */}
            <div className="mb-8">
              <h2 className="text-xl font-semibold text-center mb-6 flex items-center justify-center gap-2">
                <User className="h-5 w-5" />
                Contact These Administrators
              </h2>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {adminUsers.map((user: users) => (
                  <div
                    key={user.id}
                    className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-start space-x-3">
                      {/* Avatar or Initial */}
                      <div className="flex-shrink-0">
                        {user.avatar ? (
                          <div className="relative h-10 w-10 rounded-full overflow-hidden">
                            <Image
                              src={user.avatar}
                              alt={user.name || 'Admin'}
                              fill
                              className="object-cover"
                              sizes="40px"
                            />
                          </div>
                        ) : (
                          <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center">
                            <span className="text-blue-600 font-medium text-sm">
                              {user.name?.charAt(0).toUpperCase() || 'A'}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Admin Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="font-semibold text-gray-900 truncate">
                            {user.name || 'Administrator'}
                          </p>
                          {user.is_account_admin && (
                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                              <Shield className="h-3 w-3 mr-1" />
                              Account Admin
                            </span>
                          )}
                        </div>
                        
                        {user.email && (
                          <div className="flex items-center gap-1">
                            <Mail className="h-4 w-4 text-gray-400" />
                            <Link
                              href={`mailto:${user.email}?subject=Account Approval Request - ${process.env.NEXT_PUBLIC_APP_NAME}&body=Hello,\n\nI have created a new account on ${process.env.NEXT_PUBLIC_APP_NAME} and would like to request approval for access.\n\nMy account details:\nEmail: ${session.user?.email}\nName: ${session.user?.name || 'Not provided'}\n\nPlease let me know if you need any additional information.\n\nThank you!`}
                              className="text-blue-600 hover:text-blue-800 text-sm truncate hover:underline"
                            >
                              {user.email}
                            </Link>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="border-t pt-6">
              <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
                <Button asChild variant="outline" className="w-full sm:w-auto">
                  <Link href="/sign-in">
                    Sign in with another account
                  </Link>
                </Button>
                
                <span className="text-gray-500 text-sm">or</span>
                
                <TryAgain />
              </div>

              {/* Additional Help Text */}
              <div className="mt-6 text-center space-y-2">
                <p className="text-sm text-gray-600">
                  First user in your organization? Contact technical support for initial setup assistance.
                </p>
                <p className="text-xs text-gray-500">
                  Your account will be automatically activated once approved by an administrator.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );

  } catch (error) {
    console.error("Error loading pending page:", error);
    
    // Error fallback UI
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-2xl">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl text-red-600">
              Error Loading Page
            </CardTitle>
            <CardDescription>
              There was an error loading the page. Please try again or contact support.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center space-y-4">
            <Button asChild>
              <Link href="/sign-in">Return to Sign In</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }
};

export default PendingPage;