// file: nextcrm/app/api/invoice/[invoiceId]/route.ts
import { authOptions } from "@/lib/auth";
import { s3Client } from "@/lib/digital-ocean-s3";
import { prismadb } from "@/lib/prisma";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

//Get single invoice data
export async function GET(request: Request, props: { params: Promise<{ invoiceId: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ status: 401, body: { error: "Unauthorized" } });
  }

  const { invoiceId } = params;

  if (!invoiceId) {
    return NextResponse.json({
      status: 400,
      body: { error: "Bad Request - invoice id is mandatory" },
    });
  }

  // 🔴 ENHANCED: Include related data through relationships
  const invoice = await prismadb.invoices.findFirst({
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
        },
      },
      // 🔴 ADDED: Include invoice state information
      invoice_states: {
        select: {
          id: true,
          name: true,
        },
      },
      // 🔴 ADDED: Include documents through junction table
      documents: {
        include: {
          document: {
            select: {
              id: true,
              document_name: true,
              document_file_url: true,
              document_file_mimeType: true,
              createdAt: true,
            },
          },
        },
      },
    },
  });

  if (!invoice) {
    return NextResponse.json({
      status: 404,
      body: { error: "Invoice not found" },
    });
  }

  return NextResponse.json({ invoice }, { status: 200 });
}

//Delete single invoice by invoiceId
export async function DELETE(request: Request, props: { params: Promise<{ invoiceId: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ status: 401, body: { error: "Unauthorized" } });
  }

  const { invoiceId } = params;

  if (!invoiceId) {
    return NextResponse.json({
      status: 400,
      body: { error: "Bad Request - invoice id is mandatory" },
    });
  }

  const invoiceData = await prismadb.invoices.findFirst({
    where: {
      id: invoiceId,
    },
  });

  if (!invoiceData) {
    return NextResponse.json({
      status: 404,
      body: { error: "Invoice not found" },
    });
  }

  try {
    // 🔴 MODIFIED: Use transaction to handle junction table cleanup and file deletion
    const deletedInvoice = await prismadb.$transaction(async (tx) => {
      // 🔴 ADDED: Delete related junction table records first
      await tx.documentInvoices.deleteMany({
        where: {
          invoiceId: invoiceId,
        },
      });

      // Delete invoice from database
      const invoice = await tx.invoices.delete({
        where: {
          id: invoiceId,
        },
      });

      return invoice;
    });

    // 🔴 MOVED: File deletion after database transaction for better error handling
    //Delete files from S3

    //Delete invoice file from S3
    if (invoiceData?.invoice_file_url) {
      try {
        const bucketParams = {
          Bucket: process.env.DO_BUCKET,
          Key: `invoices/${
            invoiceData?.invoice_file_url?.split("/").slice(-1)[0]
          }`,
        };
        await s3Client.send(new DeleteObjectCommand(bucketParams));
        console.log("Success - invoice deleted from S3 bucket");
      } catch (s3Error) {
        console.log("Warning - Could not delete invoice file from S3:", s3Error);
        // 🔴 IMPROVED: Don't fail the entire operation if S3 deletion fails
      }
    }

    //Delete rossum annotation files from S3 - JSON
    if (invoiceData?.rossum_annotation_json_url) {
      try {
        const bucketParams = {
          Bucket: process.env.DO_BUCKET,
          Key: `rossum/${
            invoiceData?.rossum_annotation_json_url?.split("/").slice(-1)[0]
          }`,
        };
        await s3Client.send(new DeleteObjectCommand(bucketParams));
        console.log("Success - rossum annotation json deleted from S3 bucket");
      } catch (s3Error) {
        console.log("Warning - Could not delete rossum JSON from S3:", s3Error);
      }
    }

    //Delete rossum annotation files from S3 - XML
    if (invoiceData?.rossum_annotation_xml_url) {
      try {
        const bucketParams = {
          Bucket: process.env.DO_BUCKET,
          Key: `rossum/${
            invoiceData?.rossum_annotation_xml_url?.split("/").slice(-1)[0]
          }`,
        };
        await s3Client.send(new DeleteObjectCommand(bucketParams));
        console.log("Success - rossum annotation xml deleted from S3 bucket");
      } catch (s3Error) {
        console.log("Warning - Could not delete rossum XML from S3:", s3Error);
      }
    }

    //Delete money S3 xml document file from S3
    if (invoiceData?.money_s3_url) {
      try {
        const bucketParams = {
          Bucket: process.env.DO_BUCKET,
          Key: `xml/${invoiceData?.money_s3_url?.split("/").slice(-1)[0]}`,
        };
        await s3Client.send(new DeleteObjectCommand(bucketParams));
        console.log("Success - money S3 xml deleted from S3 bucket");
      } catch (s3Error) {
        console.log("Warning - Could not delete money S3 XML from S3:", s3Error);
      }
    }

    console.log("Invoice deleted from database");
    return NextResponse.json({ invoice: deletedInvoice }, { status: 200 });
  } catch (err) {
    console.log("Error", err);
    return NextResponse.json({
      status: 500,
      body: { error: "Something went wrong while deleting invoice" },
    });
  }
}

// 🔴 ADDED: PUT route to update invoice
export async function PUT(request: Request, props: { params: Promise<{ invoiceId: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ status: 401, body: { error: "Unauthorized" } });
  }

  const { invoiceId } = params;

  if (!invoiceId) {
    return NextResponse.json({
      status: 400,
      body: { error: "Bad Request - invoice id is mandatory" },
    });
  }

  try {
    const body = await request.json();
    const {
      description,
      invoice_number,
      invoice_amount,
      date_due,
      status,
      assigned_user_id,
      assigned_account_id,
      invoice_state_id,
      partner,
      partner_email,
      partner_VAT_number,
      // 🔴 ADDED: Support for document relationships
      documentIds = [],
    } = body;

    // 🔴 MODIFIED: Use transaction to handle junction table updates
    const updatedInvoice = await prismadb.$transaction(async (tx) => {
      // Update the invoice
      const invoice = await tx.invoices.update({
        where: {
          id: invoiceId,
        },
        data: {
          description,
          invoice_number,
          invoice_amount,
          date_due: date_due ? new Date(date_due) : null,
          status,
          assigned_user_id,
          assigned_account_id,
          invoice_state_id,
          partner,
          partner_email,
          partner_VAT_number,
          last_updated_by: session.user.id,
        },
      });

      // 🔴 ADDED: Update document relationships
      if (documentIds.length >= 0) {
        // Remove existing document relationships
        await tx.documentInvoices.deleteMany({
          where: {
            invoiceId: invoiceId,
          },
        });

        // Add new document relationships
        if (documentIds.length > 0) {
          await tx.documentInvoices.createMany({
            data: documentIds.map((documentId: string) => ({
              invoiceId: invoiceId,
              documentId,
            })),
          });
        }
      }

      return invoice;
    });

    return NextResponse.json({ invoice: updatedInvoice }, { status: 200 });
  } catch (err) {
    console.log("Error updating invoice:", err);
    return NextResponse.json({
      status: 500,
      body: { error: "Something went wrong while updating invoice" },
    });
  }
}