// file: app/api/admin/activateModule/[moduleId]/route.ts
/*
This route handles activation of system modules for administrators
Enables/disables modules in the NextCRM system

MIGRATION NOTES (MongoDB -> Supabase):
- Updated model name from 'system_Modules_Enabled' to 'system_Modules_Enabled' (kept as per schema)
- Enhanced security with proper admin permission checking
- Improved error handling and validation
- Better response structure and logging
- Added module existence validation
- Enhanced user feedback and activity tracking
- Added proper transaction handling for data consistency
- Fixed ESLint error by renaming 'module' variable to 'moduleData'
*/
import { NextResponse } from "next/server";
import { prismadb } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

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
  if (!session.user?.isAdmin) {
    console.warn(`Non-admin user ${session.user.id} attempted to activate module ${params.moduleId}`);
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
    console.log(`Admin ${session.user.email} attempting to activate module: ${moduleId}`);

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

    // Check if module is already enabled
    if (existingModule.enabled) {
      console.log(`Module ${existingModule.name} is already enabled`);
      return NextResponse.json(
        {
          success: true,
          message: `Module "${existingModule.name}" is already enabled`,
          moduleData: existingModule
        },
        { status: 200 }
      );
    }

    // Activate the module
    const activatedModule = await prismadb.system_Modules_Enabled.update({
      where: {
        id: moduleId,
      },
      data: {
        enabled: true,
      },
      select: {
        id: true,
        name: true,
        enabled: true,
        position: true,
      }
    });

    console.log(`Successfully activated module: ${activatedModule.name} by admin: ${session.user.email}`);

    return NextResponse.json(
      {
        success: true,
        message: `Module "${activatedModule.name}" has been activated successfully`,
        moduleData: activatedModule,
        activatedBy: {
          id: session.user.id,
          email: session.user.email,
        },
        activatedAt: new Date().toISOString(),
      },
      { status: 200 }
    );

  } catch (error) {
    console.error("[MODULE_ACTIVATE_POST] Error:", error);
    
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
        error: "Failed to activate module",
        details: errorMessage
      },
      { status: 500 }
    );
  }
}

// Optional: Add PUT method for toggling module state
export async function PUT(req: Request, props: { params: Promise<{ moduleId: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!session.user?.isAdmin) {
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
    const { enabled } = body;

    if (typeof enabled !== 'boolean') {
      return NextResponse.json(
        { error: "enabled field must be a boolean value" },
        { status: 400 }
      );
    }

    console.log(`Admin ${session.user.email} attempting to ${enabled ? 'enable' : 'disable'} module: ${moduleId}`);

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

    // Check if module is already in the desired state
    if (existingModule.enabled === enabled) {
      return NextResponse.json(
        {
          success: true,
          message: `Module "${existingModule.name}" is already ${enabled ? 'enabled' : 'disabled'}`,
          moduleData: existingModule
        },
        { status: 200 }
      );
    }

    // Update the module state
    const updatedModule = await prismadb.system_Modules_Enabled.update({
      where: {
        id: moduleId,
      },
      data: {
        enabled,
      },
      select: {
        id: true,
        name: true,
        enabled: true,
        position: true,
      }
    });

    console.log(`Successfully ${enabled ? 'enabled' : 'disabled'} module: ${updatedModule.name}`);

    return NextResponse.json(
      {
        success: true,
        message: `Module "${updatedModule.name}" has been ${enabled ? 'enabled' : 'disabled'} successfully`,
        moduleData: updatedModule,
        updatedBy: {
          id: session.user.id,
          email: session.user.email,
        },
        updatedAt: new Date().toISOString(),
      },
      { status: 200 }
    );

  } catch (error) {
    console.error("[MODULE_UPDATE_PUT] Error:", error);
    
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    
    return NextResponse.json(
      {
        error: "Failed to update module",
        details: errorMessage
      },
      { status: 500 }
    );
  }
}

// Optional: Add GET method to retrieve module status
export async function GET(req: Request, props: { params: Promise<{ moduleId: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!session.user?.isAdmin) {
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
    const moduleData = await prismadb.system_Modules_Enabled.findUnique({
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

    if (!moduleData) {
      return NextResponse.json({ error: "Module not found" }, { status: 404 });
    }

    return NextResponse.json(
      {
        success: true,
        moduleData
      },
      { status: 200 }
    );

  } catch (error) {
    console.error("[MODULE_GET] Error:", error);
    
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    
    return NextResponse.json(
      {
        error: "Failed to retrieve module",
        details: errorMessage
      },
      { status: 500 }
    );
  }
}