// file: nextcrm/app/api/invoice/send-by-email/[invoiceId]/route.ts
/*
This route sends invoice data as XML attachment via email to the accountant
Used for ERP system integration

MIGRATION NOTES (MongoDB -> Supabase):
- Updated model names to match new Prisma schema (MyAccount -> myAccount)
- Maintained all business logic for XML generation and email sending
- Improved error handling and response structure
- Added better logging for debugging
- Enhanced validation for required fields
- Fixed response format inconsistencies
*/
import { authOptions } from "@/lib/auth";
import { prismadb } from "@/lib/prisma";
import sendEmail from "@/lib/sendmail";
import { fillXmlTemplate } from "@/lib/xml-generator";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

export async function GET(req: Request, props: { params: Promise<{ invoiceId: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);
  
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { invoiceId } = params;

  if (!invoiceId) {
    return NextResponse.json(
      { error: "Bad Request - invoice id is mandatory" },
      { status: 400 }
    );
  }

  console.log(`Processing email send request for invoice: ${invoiceId}`);

  try {
    // Get company information (updated model name to match schema)
    console.log("Fetching company account information...");
    const myCompany = await prismadb.myAccount.findFirst({});

    if (!myCompany) {
      console.error("Company account information not found");
      return NextResponse.json(
        { error: "Company account information not found. Please configure company settings." },
        { status: 400 }
      );
    }

    // Get invoice data (model name already correct in schema)
    console.log("Fetching invoice data...");
    const invoiceData = await prismadb.invoices.findFirst({
      where: {
        id: invoiceId,
      },
    });

    if (!invoiceData) {
      console.error(`Invoice not found with ID: ${invoiceId}`);
      return NextResponse.json(
        { error: "Invoice not found" },
        { status: 404 }
      );
    }

    console.log("Generating XML template...");
    
    // Generate XML string from invoice and company data
    const xmlString = fillXmlTemplate(invoiceData, myCompany);

    if (!xmlString) {
      console.error("Failed to generate XML template");
      return NextResponse.json(
        { error: "Failed to generate XML template" },
        { status: 500 }
      );
    }

    // Create buffer from XML string
    const buffer = Buffer.from(xmlString);

    if (!buffer || buffer.length === 0) {
      console.error("Generated XML buffer is empty");
      return NextResponse.json(
        { error: "Bad Request - buffer is empty. Nothing to send." },
        { status: 400 }
      );
    }

    console.log(`XML buffer created successfully (${buffer.length} bytes)`);

    // Prepare email message
    const message = `Hello,

Please find attached invoice in XML format for your ERP system.

Invoice ID: ${invoiceId}
Invoice Number: ${invoiceData.invoice_number || 'N/A'}
Amount: ${invoiceData.invoice_amount || 'N/A'} ${invoiceData.invoice_currency || ''}

Thank you

${process.env.NEXT_PUBLIC_APP_NAME}`;

    // Validate accountant email exists
    if (!myCompany.email_accountant) {
      console.error("Accountant email not configured");
      return NextResponse.json(
        { 
          error: "Accountant email is not configured. Please fill the accountant email in the settings." 
        },
        { status: 400 }
      );
    }

    console.log(`Sending email to: ${myCompany.email_accountant}`);

    // Send email with XML attachment
    await sendEmail({
      from: process.env.EMAIL_FROM,
      to: myCompany.email_accountant,
      subject: `${process.env.NEXT_PUBLIC_APP_NAME} - Invoice ${invoiceData.invoice_number || invoiceId} (XML Format)`,
      text: message,
      attachments: [
        {
          filename: `invoice-${invoiceId}.xml`,
          content: buffer,
          contentType: "application/xml",
        },
      ],
    });

    console.log("Email sent successfully");

    // Update invoice record to track email sent
    await prismadb.invoices.update({
      where: {
        id: invoiceId,
      },
      data: {
        last_updated: new Date(),
        // You might want to add a field to track email sends
        // email_sent_at: new Date(),
      },
    });

    return NextResponse.json(
      { 
        success: true,
        message: "Email with XML attachment sent successfully",
        invoiceId: invoiceId,
        recipientEmail: myCompany.email_accountant,
        attachmentSize: buffer.length
      },
      { status: 200 }
    );

  } catch (error) {
    console.error("Error sending invoice email:", error);
    
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    
    return NextResponse.json(
      { 
        error: "Failed to send invoice email",
        details: errorMessage
      },
      { status: 500 }
    );
  }
}