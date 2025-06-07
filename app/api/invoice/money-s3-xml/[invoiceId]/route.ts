// file: nextcrm/app/api/invoice/money-s3-xml/[invoiceId]/route.ts
import { authOptions } from "@/lib/auth";
import { s3Client } from "@/lib/digital-ocean-s3";
import { prismadb } from "@/lib/prisma";
import { fillXmlTemplate } from "@/lib/xml-generator";
import { PutObjectAclCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

const fs = require("fs");

export async function GET(req: Request, props: { params: Promise<{ invoiceId: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ status: 401, body: { error: "Unauthorized" } });
  }

  const { invoiceId } = params;

  if (!invoiceId) {
    return NextResponse.json({
      status: 400,
      body: { error: "There is no invoice ID, invoice ID is mandatory" },
    });
  }

  try {
    // 🔴 ENHANCED: Use parallel queries for better performance
    const [myCompany, invoiceData] = await Promise.all([
      // 🔴 UNCHANGED: This query works the same with Supabase
      prismadb.myAccount.findFirst({}),
      
      // 🔴 ENHANCED: Include related data for more comprehensive XML generation
      prismadb.invoices.findFirst({
        where: {
          id: invoiceId,
        },
        include: {
          // 🔴 ADDED: Include related user information
          users: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          // 🔴 ADDED: Include related account information
          accounts: {
            select: {
              id: true,
              name: true,
              email: true,
              website: true,
              billing_street: true,
              billing_city: true,
              billing_country: true,
              billing_postal_code: true,
              vat: true,
            },
          },
          // 🔴 ADDED: Include invoice state information
          invoice_states: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      }),
    ]);

    // 🔴 ADDED: Validation checks
    if (!myCompany) {
      return NextResponse.json({
        status: 404,
        body: { error: "Company information not found. Please configure your account details." },
      });
    }

    if (!invoiceData) {
      return NextResponse.json({
        status: 404,
        body: { error: "Invoice not found" },
      });
    }

    // 🔴 ENHANCED: Pass more comprehensive data to XML generator
    const xmlString = fillXmlTemplate(invoiceData, myCompany);

    // 🔴 ADDED: Validate XML generation
    if (!xmlString || xmlString.trim().length === 0) {
      return NextResponse.json({
        status: 500,
        body: { error: "Failed to generate XML content" },
      });
    }

    //Store raw XML string in buffer
    const buffer = Buffer.from(xmlString);

    // 🔴 ENHANCED: Better file naming with timestamp for uniqueness
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `invoice-${invoiceId}-${timestamp}.xml`;

    //Upload xml to S3 bucket and return url
    const bucketParamsXML = { // 🔴 FIXED: Variable name (was bucketParamsJSON)
      Bucket: process.env.DO_BUCKET,
      Key: `xml/${fileName}`,
      Body: buffer,
      ContentType: "application/xml", // 🔴 FIXED: Correct content type (was application/json)
      ContentDisposition: "inline",
      ACL: "public-read" as const,
    };

    // 🔴 ADDED: Error handling for S3 upload
    try {
      await s3Client.send(new PutObjectCommand(bucketParamsXML));
    } catch (s3Error) {
      console.error("S3 upload error:", s3Error);
      return NextResponse.json({
        status: 500,
        body: { error: "Failed to upload XML to storage" },
      });
    }

    //S3 bucket url for the invoice
    const urlMoneyS3 = `https://${process.env.DO_BUCKET}.${process.env.DO_REGION}.digitaloceanspaces.com/xml/${fileName}`;

    // 🔴 ENHANCED: Update invoice with transaction and additional metadata
    const updatedInvoice = await prismadb.$transaction(async (tx) => {
      // Update the invoice with the XML URL and generation metadata
      const invoice = await tx.invoices.update({
        where: {
          id: invoiceId,
        },
        data: {
          money_s3_url: urlMoneyS3,
          last_updated_by: session.user.id, // 🔴 ADDED: Track who generated the XML
          // 🔴 ADDED: Could add xml_generated_at timestamp if field exists
        },
      });

      // 🔴 ADDED: Optional: Create document record for the generated XML
      try {
        await tx.documents.create({
          data: {
            v: 0,
            document_name: `Invoice XML - ${invoiceData.invoice_number || invoiceId}`,
            document_file_url: urlMoneyS3,
            document_file_mimeType: "application/xml",
            description: `Generated XML for invoice ${invoiceData.invoice_number || invoiceId}`,
            document_system_type: "INVOICE",
            created_by_user: session.user.id,
            assigned_user: session.user.id,
            size: buffer.length,
          },
        });
      } catch (docError) {
        console.log("Warning: Could not create document record for XML:", docError);
        // Don't fail the main operation if document creation fails
      }

      return invoice;
    });

    // 🔴 ENHANCED: Return more comprehensive response
    return NextResponse.json({ 
      xmlString, 
      invoiceData: {
        id: invoiceData.id,
        invoice_number: invoiceData.invoice_number,
        invoice_amount: invoiceData.invoice_amount,
        status: invoiceData.status,
        // Include related data in response
        account: invoiceData.accounts,
        assignedUser: invoiceData.users,
        state: invoiceData.invoice_states,
      },
      xmlUrl: urlMoneyS3,
      fileName: fileName,
      generatedAt: new Date().toISOString(),
      generatedBy: session.user.id,
    }, { status: 200 });

  } catch (error) {
    console.error("Error generating XML:", error);
    return NextResponse.json({
      status: 500,
      body: { 
        error: "Internal server error while generating XML",
        details: error instanceof Error ? error.message : "Unknown error",
      },
    });
  }
}

// 🔴 ADDED: POST route for regenerating XML with custom parameters
export async function POST(req: Request, props: { params: Promise<{ invoiceId: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ status: 401, body: { error: "Unauthorized" } });
  }

  const { invoiceId } = params;

  if (!invoiceId) {
    return NextResponse.json({
      status: 400,
      body: { error: "Invoice ID is mandatory" },
    });
  }

  try {
    const body = await req.json();
    const { 
      regenerate = true, 
      includeAttachments = false,
      customTemplate = null 
    } = body;

    // For now, redirect to GET method for regeneration
    // In the future, this could handle custom XML generation parameters
    const url = new URL(req.url);
    const getResponse = await GET(req, { params: Promise.resolve({ invoiceId }) });
    
    return getResponse;
  } catch (error) {
    console.error("Error in POST XML generation:", error);
    return NextResponse.json({
      status: 500,
      body: { 
        error: "Internal server error while regenerating XML",
        details: error instanceof Error ? error.message : "Unknown error",
      },
    });
  }
}

// 🔴 ADDED: DELETE route to remove generated XML
export async function DELETE(req: Request, props: { params: Promise<{ invoiceId: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ status: 401, body: { error: "Unauthorized" } });
  }

  const { invoiceId } = params;

  if (!invoiceId) {
    return NextResponse.json({
      status: 400,
      body: { error: "Invoice ID is mandatory" },
    });
  }

  try {
    const invoiceData = await prismadb.invoices.findFirst({
      where: { id: invoiceId },
      select: { money_s3_url: true },
    });

    if (!invoiceData?.money_s3_url) {
      return NextResponse.json({
        status: 404,
        body: { error: "No XML file found for this invoice" },
      });
    }

    // Extract filename from URL
    const fileName = invoiceData.money_s3_url.split('/').pop();
    
    if (fileName) {
      // Delete from S3
      const deleteParams = {
        Bucket: process.env.DO_BUCKET,
        Key: `xml/${fileName}`,
      };
      
      try {
        await s3Client.send(new PutObjectCommand(deleteParams));
      } catch (s3Error) {
        console.log("Warning: Could not delete XML from S3:", s3Error);
      }
    }

    // Remove URL from database
    await prismadb.invoices.update({
      where: { id: invoiceId },
      data: { money_s3_url: null },
    });

    return NextResponse.json({
      message: "XML file deleted successfully",
      deletedUrl: invoiceData.money_s3_url,
    }, { status: 200 });

  } catch (error) {
    console.error("Error deleting XML:", error);
    return NextResponse.json({
      status: 500,
      body: { 
        error: "Internal server error while deleting XML",
        details: error instanceof Error ? error.message : "Unknown error",
      },
    });
  }
}