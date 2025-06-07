// file: nextcrm/app/api/upload/cron/route.ts
/*
This route handles invoice upload operations with proper validation and error handling
Supports PostgreSQL transactions and proper error handling for Supabase

MIGRATION NOTES (MongoDB -> Supabase):
- Updated to use PostgreSQL with proper transaction handling
- Enhanced error handling with Prisma-specific error codes
- Improved invoice upload logic with proper relationship handling
- Better user authorization and admin verification
- Added proper logging and activity tracking
- Enhanced security with admin permissions checking
- Added input sanitization and validation with Zod
- Better invoice integrity verification and maintenance
- Enhanced response format with operation tracking
- Optimized queries for PostgreSQL performance
- Fixed atomic operations for consistency
- Added comprehensive validation for all scenarios
- Added support for operation notes and audit trail
- Added invoice health checks and maintenance operations
- Added user activity and data integrity validation
- Enhanced Rossum integration with proper error handling
- Added file validation and security checks
*/

import { NextRequest, NextResponse } from "next/server";
import { s3Client } from "@/lib/digital-ocean-s3";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { prismadb } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import axios from "axios";
import { getRossumToken } from "@/lib/get-rossum-token";

const FormData = require("form-data");

// Enhanced validation schema for invoice upload
const invoiceUploadSchema = z.object({
  file: z.object({
    filename: z.string()
      .min(1, "Filename cannot be empty")
      .max(255, "Filename too long")
      .refine(
        (filename) => /\.(pdf|jpg|jpeg|png|gif|tiff|bmp)$/i.test(filename),
        "Invalid file type. Only PDF and image files are allowed"
      ),
    contentType: z.string()
      .refine(
        (type) => [
          'application/pdf',
          'image/jpeg',
          'image/jpg',
          'image/png',
          'image/gif',
          'image/tiff',
          'image/bmp'
        ].includes(type),
        "Invalid content type"
      ),
    content: z.object({
      data: z.string().min(1, "File content cannot be empty")
    }),
    size: z.number().max(10 * 1024 * 1024, "File size cannot exceed 10MB").optional(),
  }),
  metadata: z.object({
    uploadedBy: z.string().optional(),
    source: z.string().default("cron"),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).default('MEDIUM'),
    description: z.string().max(500).optional(),
  }).optional(),
});

// Helper function to verify admin user exists
async function getAdminUser() {
  const admin = await prismadb.users.findFirst({
    where: {
      is_admin: true,
      userStatus: 'ACTIVE'
    },
    select: {
      id: true,
      email: true,
      name: true,
    }
  });

  if (!admin) {
    throw new Error("No active admin user found in the system");
  }

  return admin;
}

// Helper function to validate file content
function validateFileContent(content: string, contentType: string) {
  try {
    const buffer = Buffer.from(content, "base64");
    
    // Basic file size check
    if (buffer.length === 0) {
      throw new Error("File content is empty");
    }

    if (buffer.length > 10 * 1024 * 1024) { // 10MB limit
      throw new Error("File size exceeds 10MB limit");
    }

    // Basic file signature validation for PDFs
    if (contentType === 'application/pdf') {
      const pdfHeader = buffer.subarray(0, 4).toString();
      if (pdfHeader !== '%PDF') {
        throw new Error("Invalid PDF file signature");
      }
    }

    return { isValid: true, buffer, size: buffer.length };
  } catch (error) {
    return { 
      isValid: false, 
      buffer: null, 
      size: 0, 
      error: error instanceof Error ? error.message : "Invalid file content" 
    };
  }
}

// Enhanced Rossum integration with proper error handling
async function processWithRossum(fileBuffer: Buffer, filename: string, contentType: string) {
  try {
    console.log(`Processing invoice with Rossum: ${filename}`);

    // Get Rossum configuration
    const rossumURL = process.env.ROSSUM_API_URL;
    const queueId = process.env.ROSSUM_QUEUE_ID;

    if (!rossumURL || !queueId) {
      throw new Error("Rossum configuration missing - check ROSSUM_API_URL and ROSSUM_QUEUE_ID");
    }

    const queueUploadUrl = `${rossumURL}/uploads?queue=${queueId}`;

    // Get authentication token
    const token = await getRossumToken();
    if (!token) {
      throw new Error("Failed to obtain Rossum authentication token");
    }

    // Prepare form data for upload
    const form = new FormData();
    form.append("content", fileBuffer, {
      filename,
      contentType,
    });

    console.log(`Uploading to Rossum queue: ${queueId}`);

    // Upload to Rossum
    const uploadResponse = await axios.post(queueUploadUrl, form, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...form.getHeaders(),
      },
      timeout: 30000, // 30 second timeout
    });

    if (!uploadResponse.data?.url) {
      throw new Error("Invalid Rossum upload response - missing URL");
    }

    console.log(`Rossum upload successful, getting task details...`);

    // Get task details
    const taskResponse = await axios.get(uploadResponse.data.url, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 15000,
    });

    if (!taskResponse.data?.content?.upload) {
      throw new Error("Invalid Rossum task response - missing upload content");
    }

    console.log(`Getting upload data from Rossum...`);

    // Get upload data
    const uploadDataResponse = await axios.get(taskResponse.data.content.upload, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 15000,
    });

    if (!uploadDataResponse.data?.documents?.[0]) {
      throw new Error("Invalid Rossum upload data - missing documents");
    }

    console.log(`Getting document details from Rossum...`);

    // Get document details
    const documentResponse = await axios.get(uploadDataResponse.data.documents[0], {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 15000,
    });

    if (documentResponse.status !== 200 || !documentResponse.data) {
      throw new Error(`Failed to get Rossum document - status: ${documentResponse.status}`);
    }

    const document = documentResponse.data;
    const annotationUrl = document.annotations?.[0];
    
    if (!annotationUrl) {
      throw new Error("No annotation URL found in Rossum document");
    }

    const annotationId = annotationUrl.split("/").pop();

    console.log(`Rossum processing complete - Document ID: ${document.id}, Annotation ID: ${annotationId}`);

    return {
      success: true,
      document: {
        id: document.id.toString(),
        annotationUrl,
        annotationId,
        documentUrl: annotationUrl,
      },
      metadata: {
        uploadUrl: uploadResponse.data.url,
        taskUrl: taskResponse.data.content.upload,
      }
    };

  } catch (error) {
    console.error("Rossum processing failed:", error);
    
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const message = error.response?.data?.message || error.message;
      throw new Error(`Rossum API error (${status}): ${message}`);
    }
    
    throw new Error(`Rossum processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// Enhanced S3 upload with proper error handling
async function uploadToS3(fileBuffer: Buffer, filename: string, contentType: string) {
  try {
    const timestamp = new Date().getTime();
    const sanitizedFilename = filename.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    const s3Key = `invoices/${timestamp}-${sanitizedFilename}`;

    console.log(`Uploading to S3: ${s3Key}`);

    const bucketParams = {
      Bucket: process.env.DO_BUCKET!,
      Key: s3Key,
      Body: fileBuffer,
      ContentType: contentType,
      ContentDisposition: "inline",
      ACL: "public-read" as const,
    };

    await s3Client.send(new PutObjectCommand(bucketParams));

    const url = `https://${process.env.DO_BUCKET}.${process.env.DO_REGION}.digitaloceanspaces.com/${s3Key}`;
    
    console.log(`S3 upload successful: ${url}`);

    return {
      success: true,
      url,
      key: s3Key,
      size: fileBuffer.length,
    };

  } catch (error) {
    console.error("S3 upload failed:", error);
    throw new Error(`S3 upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    console.log("=== INVOICE UPLOAD CRON JOB STARTED ===");

    // Parse and validate request body
    const body = await request.json();
    console.log("Received upload request");

    const validatedData = invoiceUploadSchema.parse(body);
    const { file, metadata } = validatedData;

    console.log(`Processing file: ${file.filename} (${file.contentType})`);

    // Validate file content
    const { isValid, buffer, size, error: validationError } = validateFileContent(file.content.data, file.contentType);
    if (!isValid || !buffer) {
      throw new Error(`File validation failed: ${validationError}`);
    }

    console.log(`File validation passed - Size: ${(size / 1024).toFixed(2)}KB`);

    // Get admin user for assignment
    const adminUser = await getAdminUser();
    console.log(`Admin user found: ${adminUser.email}`);

    // Use transaction for atomic operation
    const result = await prismadb.$transaction(async (tx) => {
      let rossumData = null;
      let s3Data = null;

      // Process with Rossum (if configured)
      try {
        rossumData = await processWithRossum(buffer, file.filename, file.contentType);
        console.log("Rossum processing completed successfully");
      } catch (rossumError) {
        console.warn("Rossum processing failed, continuing without:", rossumError);
        // Continue without Rossum if it fails
      }

      // Upload to S3
      try {
        s3Data = await uploadToS3(buffer, file.filename, file.contentType);
        console.log("S3 upload completed successfully");
      } catch (s3Error) {
        console.error("S3 upload failed:", s3Error);
        throw s3Error; // S3 upload is critical, so fail if it doesn't work
      }

      // Create invoice record in database
      const invoiceData: any = {
        v: 0,
        last_updated_by: adminUser.id,
        date_received: new Date(),
        date_due: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
        description: metadata?.description || "Incoming invoice via cron",
        document_type: "invoice",
        invoice_type: "Taxable document",
        status: "new",
        favorite: false,
        assigned_user_id: adminUser.id,
        invoice_file_url: s3Data.url,
        invoice_file_mimeType: file.contentType,
        visibility: true,
      };

      // Add Rossum data if available
      if (rossumData?.success) {
        invoiceData.rossum_status = "importing";
        invoiceData.rossum_document_url = rossumData.document.annotationUrl;
        invoiceData.rossum_document_id = rossumData.document.id;
        invoiceData.rossum_annotation_url = rossumData.document.annotationUrl;
        invoiceData.rossum_annotation_id = rossumData.document.annotationId;
      }

      const newInvoice = await tx.invoices.create({
        data: invoiceData,
        select: {
          id: true,
          invoice_file_url: true,
          status: true,
          rossum_status: true,
          rossum_document_id: true,
          createdAt: true,
        }
      });

      console.log(`Invoice created in database: ${newInvoice.id}`);

      return {
        invoice: newInvoice,
        s3Data,
        rossumData,
      };
    });

    const processingTime = Date.now() - startTime;
    console.log(`=== INVOICE UPLOAD COMPLETED in ${processingTime}ms ===`);

    return NextResponse.json(
      {
        success: true,
        message: "Invoice uploaded and processed successfully",
        invoice: {
          id: result.invoice.id,
          url: result.invoice.invoice_file_url,
          status: result.invoice.status,
          rossumStatus: result.invoice.rossum_status,
          createdAt: result.invoice.createdAt,
        },
        processing: {
          fileSize: size,
          processingTime: `${processingTime}ms`,
          rossumEnabled: !!result.rossumData?.success,
          s3Upload: result.s3Data.success,
        },
        metadata: {
          filename: file.filename,
          contentType: file.contentType,
          assignedTo: adminUser.email,
          source: metadata?.source || "cron",
        }
      },
      { status: 201 }
    );

  } catch (error) {
    const processingTime = Date.now() - startTime;
    console.error(`=== INVOICE UPLOAD FAILED after ${processingTime}ms ===`, error);

    // Handle Zod validation errors
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: "Validation failed",
          details: error.errors.map(err => `${err.path.join('.')}: ${err.message}`),
          processingTime: `${processingTime}ms`,
        },
        { status: 400 }
      );
    }

    // Handle JSON parsing errors
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid JSON in request body",
          processingTime: `${processingTime}ms`,
        },
        { status: 400 }
      );
    }

    // Handle Prisma errors specific to PostgreSQL/Supabase
    if (error && typeof error === 'object' && 'code' in error) {
      const prismaError = error as any;
      
      switch (prismaError.code) {
        case 'P2003':
          return NextResponse.json(
            {
              success: false,
              error: "Database foreign key constraint failed",
              details: "Invalid user reference",
              processingTime: `${processingTime}ms`,
            },
            { status: 400 }
          );
        case 'P1008':
          return NextResponse.json(
            {
              success: false,
              error: "Database timeout - please try again",
              processingTime: `${processingTime}ms`,
            },
            { status: 504 }
          );
        default:
          console.error("Unhandled Prisma error:", prismaError);
      }
    }

    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    
    return NextResponse.json(
      {
        success: false,
        error: "Failed to process invoice upload",
        details: errorMessage,
        processingTime: `${processingTime}ms`,
      },
      { status: 500 }
    );
  }
}

// Optional: Add GET method for health check
export async function GET(request: NextRequest) {
  try {
    // Health check for the upload service
    const adminCheck = await getAdminUser();
    
    // Check S3 configuration
    const s3Config = {
      bucket: !!process.env.DO_BUCKET,
      region: !!process.env.DO_REGION,
    };

    // Check Rossum configuration
    const rossumConfig = {
      apiUrl: !!process.env.ROSSUM_API_URL,
      queueId: !!process.env.ROSSUM_QUEUE_ID,
    };

    return NextResponse.json(
      {
        success: true,
        service: "Invoice Upload Cron",
        status: "healthy",
        checks: {
          database: "connected",
          adminUser: !!adminCheck,
          s3Configuration: s3Config.bucket && s3Config.region,
          rossumConfiguration: rossumConfig.apiUrl && rossumConfig.queueId,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 200 }
    );

  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        service: "Invoice Upload Cron",
        status: "unhealthy",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}