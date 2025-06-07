// file: nextcrm/app/[locale]/(routes)/admin/users/page.tsx
/*
This page provides user administration functionality for system administrators
Includes user management, invitations, and bulk email operations

MIGRATION NOTES (MongoDB -> Supabase):
- Updated Prisma type import from 'Users' to 'users' (lowercase as per schema)
- Enhanced security with proper admin role checking
- Improved error handling and loading states
- Better UI with status indicators and user statistics
- Added proper access control and permission validation
- Enhanced user experience with better organization
*/
import { getUsers } from "@/actions/get-users";
import React from "react";
import Container from "../../components/ui/Container";
import { InviteForm } from "./components/IviteForm";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { AdminUserDataTable } from "./table-components/data-table";
import { columns } from "./table-components/columns";
import { users } from "@prisma/client"; // Updated to lowercase as per schema
import { Button } from "@/components/ui/button";
import SendMailToAll from "./components/send-mail-to-all";
import { 
  Users as UsersIcon, 
  UserPlus, 
  Mail, 
  Shield, 
  AlertTriangle, 
  CheckCircle,
  Clock,
  UserX
} from "lucide-react";
import { redirect } from "next/navigation";

const AdminUsersPage = async () => {
  try {
    console.log("Loading admin users page...");
    
    // Get current session and validate admin access
    const session = await getServerSession(authOptions);

    if (!session) {
      console.log("No session found, redirecting to sign-in");
      redirect("/sign-in");
    }

    if (!session.user?.is_admin) {
      console.warn(`Non-admin user ${session.user?.id} attempted to access admin users page`);
      return (
        <Container
          title="Access Denied"
          description="Administrator privileges required"
        >
          <div className="min-h-[400px] flex items-center justify-center">
            <Card className="w-full max-w-md">
              <CardHeader className="text-center">
                <div className="flex justify-center mb-4">
                  <div className="rounded-full bg-red-100 p-3">
                    <Shield className="h-8 w-8 text-red-600" />
                  </div>
                </div>
                <CardTitle className="text-xl text-red-600">Access Denied</CardTitle>
              </CardHeader>
              <CardContent className="text-center space-y-4">
                <p className="text-gray-600">
                  You need administrator privileges to access user management.
                </p>
                <p className="text-sm text-gray-500">
                  Contact your system administrator if you believe this is an error.
                </p>
              </CardContent>
            </Card>
          </div>
        </Container>
      );
    }

    // Fetch users data
    console.log("Fetching users data...");
    const users: users[] = await getUsers();
    console.log(`Found ${users.length} users`);

    // Calculate user statistics
    const userStats = {
      total: users.length,
      active: users.filter(user => user.userStatus === "ACTIVE").length,
      pending: users.filter(user => user.userStatus === "PENDING").length,
      inactive: users.filter(user => user.userStatus === "INACTIVE").length,
      admins: users.filter(user => user.is_admin).length,
    };

    return (
      <Container
        title="User Administration"
        description="Manage NextCRM users, invitations, and permissions"
      >
        <div className="space-y-6">
          {/* User Statistics */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center space-x-2">
                  <UsersIcon className="h-5 w-5 text-blue-600" />
                  <div>
                    <p className="text-2xl font-bold">{userStats.total}</p>
                    <p className="text-xs text-gray-600">Total Users</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center space-x-2">
                  <CheckCircle className="h-5 w-5 text-green-600" />
                  <div>
                    <p className="text-2xl font-bold text-green-600">{userStats.active}</p>
                    <p className="text-xs text-gray-600">Active Users</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center space-x-2">
                  <Clock className="h-5 w-5 text-amber-600" />
                  <div>
                    <p className="text-2xl font-bold text-amber-600">{userStats.pending}</p>
                    <p className="text-xs text-gray-600">Pending Approval</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center space-x-2">
                  <UserX className="h-5 w-5 text-red-600" />
                  <div>
                    <p className="text-2xl font-bold text-red-600">{userStats.inactive}</p>
                    <p className="text-xs text-gray-600">Inactive Users</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center space-x-2">
                  <Shield className="h-5 w-5 text-purple-600" />
                  <div>
                    <p className="text-2xl font-bold text-purple-600">{userStats.admins}</p>
                    <p className="text-xs text-gray-600">Administrators</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Alerts and Notifications */}
          <div className="space-y-3">
            {userStats.pending > 0 && (
              <Alert className="border-amber-200 bg-amber-50">
                <Clock className="h-4 w-4 text-amber-600" />
                <AlertDescription className="text-amber-700">
                  <span className="font-medium">{userStats.pending} user{userStats.pending !== 1 ? 's' : ''}</span> 
                  {' '}pending approval. Review and activate new accounts to grant system access.
                </AlertDescription>
              </Alert>
            )}

            {userStats.admins === 1 && (
              <Alert className="border-blue-200 bg-blue-50">
                <Shield className="h-4 w-4 text-blue-600" />
                <AlertDescription className="text-blue-700">
                  Only one administrator account exists. Consider promoting additional users to admin for redundancy.
                </AlertDescription>
              </Alert>
            )}

            {userStats.inactive > userStats.active && (
              <Alert className="border-orange-200 bg-orange-50">
                <AlertTriangle className="h-4 w-4 text-orange-600" />
                <AlertDescription className="text-orange-700">
                  More users are inactive than active. Consider reviewing inactive accounts and user onboarding processes.
                </AlertDescription>
              </Alert>
            )}
          </div>

          {/* User Invitation Section */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserPlus className="h-5 w-5 text-green-600" />
                Invite New User
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <p className="text-sm text-gray-600">
                  Invite new users to join your NextCRM instance. They will receive an email with instructions to create their account.
                </p>
                <InviteForm />
              </div>
            </CardContent>
          </Card>

          <Separator />

          {/* Bulk Email Section */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5 text-blue-600" />
                Bulk Communications
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <p className="text-sm text-gray-600">
                  Send announcements or notifications to all active users in the system.
                </p>
                <SendMailToAll />
              </div>
            </CardContent>
          </Card>

          <Separator />

          {/* Users Data Table */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <UsersIcon className="h-5 w-5 text-gray-600" />
                  User Management
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <span>Total: {userStats.total}</span>
                  <Badge variant="secondary" className="bg-green-100 text-green-700">
                    {userStats.active} Active
                  </Badge>
                  {userStats.pending > 0 && (
                    <Badge variant="secondary" className="bg-amber-100 text-amber-700">
                      {userStats.pending} Pending
                    </Badge>
                  )}
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <AdminUserDataTable columns={columns} data={users} />
            </CardContent>
          </Card>
        </div>
      </Container>
    );

  } catch (error) {
    console.error("Error loading admin users page:", error);
    
    // Error fallback UI
    return (
      <Container
        title="Error Loading Users"
        description="There was an error loading the user administration page"
      >
        <div className="min-h-[400px] flex items-center justify-center">
          <Card className="w-full max-w-md">
            <CardHeader className="text-center">
              <div className="flex justify-center mb-4">
                <div className="rounded-full bg-red-100 p-3">
                  <AlertTriangle className="h-8 w-8 text-red-600" />
                </div>
              </div>
              <CardTitle className="text-xl text-red-600">Loading Error</CardTitle>
            </CardHeader>
            <CardContent className="text-center space-y-4">
              <p className="text-gray-600">
                Failed to load user administration page.
              </p>
              <p className="text-sm text-gray-500">
                Please refresh the page or contact support if the problem persists.
              </p>
              <Button 
                onClick={() => window.location.reload()} 
                className="w-full"
              >
                Refresh Page
              </Button>
            </CardContent>
          </Card>
        </div>
      </Container>
    );
  }
};

export default AdminUsersPage;