// file: nextcrm/app/api/documents/[documentId]/route.ts
/*
This route handles document deletion including file cleanup from storage
Deletes both database record and associated file from UploadThing storage

MIGRATION NOTES (MongoDB -> Supabase):
- Updated model name from 'documents' to 'Documents' (Pascal case for Prisma)
- Fixed logic issues: changed findMany to findUnique for single document lookup
- Improved error handling and response structure
- Added proper validation and logging
- Enhanced cascade deletion handling for related junction tables
- Better file cleanup error handling
- Maintained UploadThing integration
*/
import { authOptions } from "@/lib/auth";
import { prismadb } from "@/lib/prisma";
import { utapi } from "@/lib/server/uploadthings";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

export async function DELETE(req: Request, props: { params: Promise<{ documentId: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { documentId } = params;

  if (!documentId) {
    return NextResponse.json({ error: "Document ID is required" }, { status: 400 });
  }

  console.log(`Processing delete request for document: ${documentId}`);

  try {
    // Find the document first (using findUnique instead of findMany for single record)
    const document = await prismadb.documents.findUnique({
      where: {
        id: documentId,
      },
      include: {
        // Include related data for logging/validation if needed
        assigned_to_user: {
          select: {
            id: true,
            name: true,
          }
        },
        created_by: {
          select: {
            id: true,
            name: true,
          }
        }
      }
    });

    if (!document) {
      console.error(`Document not found in database: ${documentId}`);
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    console.log(`Found document: ${document.document_name} (${document.document_file_mimeType})`);

    // Check if user has permission to delete (optional - add business logic here)
    // For example, only allow deletion if user is the creator or assigned user
    const canDelete = 
      document.created_by_user === session.user?.id || 
      document.assigned_user === session.user?.id ||
      session.user?.is_admin; // Assuming you have admin role

    if (!canDelete) {
      console.warn(`User ${session.user?.id} attempted to delete document ${documentId} without permission`);
      return NextResponse.json({ error: "Insufficient permissions to delete this document" }, { status: 403 });
    }

    // Store file key for cleanup before deleting the record
    const fileKey = document.key;

    // Delete the document from database
    // Note: Related junction table records will be automatically deleted due to onDelete: Cascade
    console.log("Deleting document from database...");
    const deletedDocument = await prismadb.documents.delete({
      where: {
        id: documentId,
      },
    });

    console.log(`Document deleted from database: ${deletedDocument.document_name}`);

    // Clean up file from UploadThing storage if key exists
    if (fileKey) {
      try {
        console.log(`Deleting file from storage with key: ${fileKey}`);
        const utapiResult = await utapi.deleteFiles([fileKey]);
        
        if (utapiResult.success) {
          console.log("File successfully deleted from storage");
        } else {
          console.warn("File deletion from storage failed:", utapiResult);
          // Don't fail the entire operation if file cleanup fails
        }
      } catch (storageError) {
        console.error("Error deleting file from storage:", storageError);
        // Log error but don't fail the operation since DB record is already deleted
      }
    } else {
      console.warn(`No file key found for document ${documentId}, skipping file cleanup`);
    }

    return NextResponse.json(
      { 
        success: true,
        message: "Document deleted successfully",
        deletedDocument: {
          id: deletedDocument.id,
          name: deletedDocument.document_name,
          type: deletedDocument.document_file_mimeType
        }
      },
      { status: 200 }
    );

  } catch (error) {
    console.error("[Document_DELETE] Error:", error);
    
    // Provide more specific error information
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    
    return NextResponse.json(
      { 
        error: "Failed to delete document",
        details: errorMessage
      },
      { status: 500 }
    );
  }
}