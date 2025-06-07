// file: app/api/admin/deactivateModule/[moduleId]/route.ts
/*
This route handles deactivation of system modules for administrators
Disables modules in the NextCRM system with proper validation and logging

MIGRATION NOTES (MongoDB -> Supabase):
- Updated model name from 'system_Modules_Enabled' to 'system_Modules_Enabled' (kept as per schema)
- Enhanced security with proper admin permission checking
- Improved error handling and validation
- Better response structure and logging
- Added module existence validation
- Enhanced user feedback and activity tracking
- Added safety checks for critical modules
- Consistent with the activation route patterns
*/
import { NextResponse } from "next/server";
import { prismadb } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

// Critical modules that should not be deactivated
const CRITICAL_MODULES = ['auth', 'users', 'admin', 'core'];

export async function POST(req: Request, props: { params: Promise<{ moduleId: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);

  // Enhanced authentication and authorization
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!session.user?.id) {
    return NextResponse.json({ error: "User ID not found in session" }, { status: 401 });
  }

  // Check if user is admin - only admins can activate/deactivate modules
  if (!session.user?.is_admin) {
    console.warn(`Non-admin user ${session.user.id} attempted to deactivate module ${params.moduleId}`);
    return NextResponse.json(
      { error: "Administrator privileges required to manage modules" },
      { status: 403 }
    );
  }

  const { moduleId } = params;

  if (!moduleId) {
    return NextResponse.json({ error: "Module ID is required" }, { status: 400 });
  }

  try {
    console.log(`Admin ${session.user.email} attempting to deactivate module: ${moduleId}`);

    // Check if the module exists
    const existingModule = await prismadb.system_Modules_Enabled.findUnique({
      where: {
        id: moduleId,
      },
      select: {
        id: true,
        name: true,
        enabled: true,
        position: true,
      }
    });

    if (!existingModule) {
      console.error(`Module not found: ${moduleId}`);
      return NextResponse.json({ error: "Module not found" }, { status: 404 });
    }

    // Check if module is already disabled
    if (!existingModule.enabled) {
      console.log(`Module ${existingModule.name} is already disabled`);
      return NextResponse.json(
        {
          success: true,
          message: `Module "${existingModule.name}" is already disabled`,
          module: existingModule
        },
        { status: 200 }
      );
    }

    // Safety check: Prevent deactivation of critical modules
    if (CRITICAL_MODULES.includes(existingModule.name.toLowerCase())) {
      console.warn(`Admin ${session.user.email} attempted to deactivate critical module: ${existingModule.name}`);
      return NextResponse.json(
        {
          error: `Cannot deactivate critical module "${existingModule.name}"`,
          reason: "This module is essential for system operation and cannot be disabled",
          criticalModules: CRITICAL_MODULES
        },
        { status: 400 }
      );
    }

    // Deactivate the module
    const deactivatedModule = await prismadb.system_Modules_Enabled.update({
      where: {
        id: moduleId,
      },
      data: {
        enabled: false,
      },
      select: {
        id: true,
        name: true,
        enabled: true,
        position: true,
      }
    });

    console.log(`Successfully deactivated module: ${deactivatedModule.name} by admin: ${session.user.email}`);

    return NextResponse.json(
      {
        success: true,
        message: `Module "${deactivatedModule.name}" has been deactivated successfully`,
        module: deactivatedModule,
        deactivatedBy: {
          id: session.user.id,
          email: session.user.email,
        },
        deactivatedAt: new Date().toISOString(),
        warning: "Module functionality will be unavailable until reactivated"
      },
      { status: 200 }
    );

  } catch (error) {
    console.error("[MODULE_DEACTIVATE_POST] Error:", error);
    
    // Handle specific Prisma errors
    if (error instanceof Error) {
      if (error.message.includes('Record to update not found')) {
        return NextResponse.json({ error: "Module not found" }, { status: 404 });
      }
      
      if (error.message.includes('Unique constraint failed')) {
        return NextResponse.json(
          { error: "Module configuration conflict" },
          { status: 409 }
        );
      }
    }

    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    
    return NextResponse.json(
      {
        error: "Failed to deactivate module",
        details: errorMessage
      },
      { status: 500 }
    );
  }
}

// Optional: Add DELETE method for permanent module removal (use with caution)
export async function DELETE(req: Request, props: { params: Promise<{ moduleId: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!session.user?.is_admin) {
    return NextResponse.json(
      { error: "Administrator privileges required" },
      { status: 403 }
    );
  }

  const { moduleId } = params;

  if (!moduleId) {
    return NextResponse.json({ error: "Module ID is required" }, { status: 400 });
  }

  try {
    // Get confirmation from request body
    const body = await req.json();
    const { confirmDeletion, adminPassword } = body;

    if (!confirmDeletion) {
      return NextResponse.json(
        {
          error: "Deletion confirmation required",
          message: "This action permanently removes the module from the system"
        },
        { status: 400 }
      );
    }

    console.log(`Admin ${session.user.email} attempting to permanently delete module: ${moduleId}`);

    // Check if the module exists
    const existingModule = await prismadb.system_Modules_Enabled.findUnique({
      where: {
        id: moduleId,
      },
      select: {
        id: true,
        name: true,
        enabled: true,
        position: true,
      }
    });

    if (!existingModule) {
      return NextResponse.json({ error: "Module not found" }, { status: 404 });
    }

    // Safety check: Prevent deletion of critical modules
    if (CRITICAL_MODULES.includes(existingModule.name.toLowerCase())) {
      console.warn(`Admin ${session.user.email} attempted to delete critical module: ${existingModule.name}`);
      return NextResponse.json(
        {
          error: `Cannot delete critical module "${existingModule.name}"`,
          reason: "This module is essential for system operation and cannot be removed",
          criticalModules: CRITICAL_MODULES
        },
        { status: 400 }
      );
    }

    // Delete the module
    const deletedModule = await prismadb.system_Modules_Enabled.delete({
      where: {
        id: moduleId,
      }
    });

    console.log(`Successfully deleted module: ${existingModule.name} by admin: ${session.user.email}`);

    return NextResponse.json(
      {
        success: true,
        message: `Module "${existingModule.name}" has been permanently deleted`,
        deletedModule: {
          id: deletedModule.id,
          name: existingModule.name,
        },
        deletedBy: {
          id: session.user.id,
          email: session.user.email,
        },
        deletedAt: new Date().toISOString(),
        warning: "This action cannot be undone"
      },
      { status: 200 }
    );

  } catch (error) {
    console.error("[MODULE_DELETE] Error:", error);
    
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    
    return NextResponse.json(
      {
        error: "Failed to delete module",
        details: errorMessage
      },
      { status: 500 }
    );
  }
}

// Optional: Add PATCH method for bulk module operations
export async function PATCH(req: Request, props: { params: Promise<{ moduleId: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!session.user?.is_admin) {
    return NextResponse.json(
      { error: "Administrator privileges required" },
      { status: 403 }
    );
  }

  const { moduleId } = params;

  if (!moduleId) {
    return NextResponse.json({ error: "Module ID is required" }, { status: 400 });
  }

  try {
    const body = await req.json();
    const { position } = body;

    if (typeof position !== 'number') {
      return NextResponse.json(
        { error: "position field must be a number" },
        { status: 400 }
      );
    }

    console.log(`Admin ${session.user.email} updating module position: ${moduleId} to position ${position}`);

    // Check if the module exists
    const existingModule = await prismadb.system_Modules_Enabled.findUnique({
      where: {
        id: moduleId,
      },
      select: {
        id: true,
        name: true,
        enabled: true,
        position: true,
      }
    });

    if (!existingModule) {
      return NextResponse.json({ error: "Module not found" }, { status: 404 });
    }

    // Update the module position
    const updatedModule = await prismadb.system_Modules_Enabled.update({
      where: {
        id: moduleId,
      },
      data: {
        position,
      },
      select: {
        id: true,
        name: true,
        enabled: true,
        position: true,
      }
    });

    console.log(`Successfully updated module position: ${updatedModule.name} to position ${position}`);

    return NextResponse.json(
      {
        success: true,
        message: `Module "${updatedModule.name}" position updated successfully`,
        module: updatedModule,
        updatedBy: {
          id: session.user.id,
          email: session.user.email,
        },
        updatedAt: new Date().toISOString(),
      },
      { status: 200 }
    );

  } catch (error) {
    console.error("[MODULE_POSITION_UPDATE] Error:", error);
    
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    
    return NextResponse.json(
      {
        error: "Failed to update module position",
        details: errorMessage
      },
      { status: 500 }
    );
  }
}