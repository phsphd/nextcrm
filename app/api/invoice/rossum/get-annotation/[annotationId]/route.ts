// file: nextcrm/app/api/invoice/rossum/get-annotation/[annotationId]/route.ts
/*
This route will get annotation from Rossum API and store it in S3 bucket as JSON and XML file and make it available for download
Next step is to update invoice metadata from annotation in database (invoice table)
TODO: think about how to handle annotation files security - now they are public

MIGRATION NOTES (MongoDB -> Supabase):
- Updated field mappings to match new Prisma schema structure
- Changed from 'invoices' to 'Invoices' model (Pascal case for Prisma)
- Updated field names to match new schema (e.g., invoice_amount vs invoiceAmount)
- Removed MongoDB-specific operations and adapted to Prisma/PostgreSQL
- Maintained all business logic for Rossum API integration
- Updated error handling and response structure for better type safety
- Field mappings now align with junction table structure for related entities
*/
import { authOptions } from "@/lib/auth";
import { s3Client } from "@/lib/digital-ocean-s3";
import { getRossumToken } from "@/lib/get-rossum-token";
import { prismadb } from "@/lib/prisma";
import { PutObjectAclCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

export async function GET(req: Request, props: { params: Promise<{ annotationId: string }> }) {
  const params = await props.params;
  const session = await getServerSession(authOptions);
  
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const queueId = process.env.ROSSUM_QUEUE_ID;

  if (!queueId) {
    return NextResponse.json({ error: "No queueId provided" }, { status: 400 });
  }

  const { annotationId } = params;

  if (!annotationId) {
    return NextResponse.json({ error: "No annotationId provided" }, { status: 400 });
  }

  const token = await getRossumToken();

  if (!token) {
    return NextResponse.json({ error: "No rossum token" }, { status: 400 });
  }

  console.log(`Processing annotation ID: ${annotationId}`);

  // Fetch annotation data from Rossum API
  const data = await fetch(
    `${process.env.ROSSUM_API_URL}/queues/${queueId}/export/?format=json&id=${annotationId}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    }
  )
    .then((r) => r.json())
    .then((data) => {
      console.log("Rossum API response received");
      return data;
    });

  console.log(`Annotation status: ${data.results[0].status}`);

  if (data.results[0].status === "importing") {
    return NextResponse.json(
      { error: "Data from rossum API not ready yet!" },
      { status: 400 }
    );
  }

  // Initialize invoice data structures (adapted for new schema)
  const basicInfoSectionData = {
    document_id: "",
    order_id: "",
    date_issue: new Date(),
    date_due: new Date(),
    document_type: "",
    language: "",
  };
  
  const paymentInfoSectionData = {
    vendor_bank: "",
    account_num: "",
    bank_num: "",
    iban: "",
    bic: "",
    var_sym: "",
    spec_sym: "",
  };
  
  const amountSectionData = {
    amount_total: "",
    amount_total_base: "",
    amount_total_tax: "",
    currency: "",
  };
  
  const vendorSectionData = {
    sender_name: "",
    vendor_street: "",
    vendor_city: "",
    vendor_zip: "",
    sender_ic: "",
    sender_vat_id: "",
    sender_email: "",
    recipient_ic: "",
  };

  if (data.results && data.results.length > 0) {
    console.log("Processing annotation sections...");
    
    // Extract sections from annotation data
    const basicInfoSection = data.results[0].content.find(
      (section: any) => section.schema_id === "basic_info_section"
    );

    const amountsSection = data.results[0].content.find(
      (section: any) => section.schema_id === "amounts_section"
    );

    const paymentInfoSection = data.results[0].content.find(
      (section: any) => section.schema_id === "payment_info_section"
    );

    const vendorSection = data.results[0].content.find(
      (section: any) => section.schema_id === "vendor_section"
    );

    // Process basic info section
    if (basicInfoSection) {
      const documentIdDataPoint = basicInfoSection.children.find(
        (datapoint: any) => datapoint.schema_id === "document_id"
      );
      if (documentIdDataPoint) {
        basicInfoSectionData.document_id = documentIdDataPoint.value;
        console.log("Document ID:", basicInfoSectionData.document_id);
      }

      const orderIdDataPoint = basicInfoSection.children.find(
        (datapoint: any) => datapoint.schema_id === "order_id"
      );
      if (orderIdDataPoint) {
        basicInfoSectionData.order_id = orderIdDataPoint.value;
        console.log("Order ID:", basicInfoSectionData.order_id);
      }

      const documentTypeDataPoint = basicInfoSection.children.find(
        (datapoint: any) => datapoint.schema_id === "document_type"
      );
      if (documentTypeDataPoint) {
        basicInfoSectionData.document_type = documentTypeDataPoint.value;
        console.log("Document Type:", basicInfoSectionData.document_type);
      }

      // Process issue date with improved error handling
      const dateIssueDataPoint = basicInfoSection.children.find(
        (datapoint: any) => datapoint.schema_id === "date_issue"
      );
      if (dateIssueDataPoint && dateIssueDataPoint.value) {
        try {
          const dateValue = dateIssueDataPoint.value;
          const dateComponents = dateValue.split("-").map(Number);
          if (dateComponents.length === 3 && !dateComponents.some(isNaN)) {
            const [year, month, day] = dateComponents;
            const formattedDate = new Date(year, month - 1, day);
            
            if (!isNaN(formattedDate.getTime())) {
              basicInfoSectionData.date_issue = formattedDate;
              console.log("Issue Date:", formattedDate);
            } else {
              console.error("Invalid date components for issue date");
            }
          } else {
            console.error("Invalid date format for issue date");
          }
        } catch (error) {
          console.error("Error processing issue date:", error);
        }
      }

      // Process due date with improved error handling
      const dueDateDataPoint = basicInfoSection.children.find(
        (datapoint: any) => datapoint.schema_id === "date_due"
      );
      if (dueDateDataPoint && dueDateDataPoint.value) {
        try {
          const dateValue = dueDateDataPoint.value;
          const dateComponents = dateValue.split("-").map(Number);
          if (dateComponents.length === 3 && !dateComponents.some(isNaN)) {
            const [year, month, day] = dateComponents;
            const formattedDate = new Date(year, month - 1, day);
            
            if (!isNaN(formattedDate.getTime())) {
              basicInfoSectionData.date_due = formattedDate;
              console.log("Due Date:", formattedDate);
            } else {
              console.error("Invalid date components for due date");
            }
          } else {
            console.error("Invalid date format for due date");
          }
        } catch (error) {
          console.error("Error processing due date:", error);
        }
      }

      const languageDataPoint = basicInfoSection.children.find(
        (datapoint: any) => datapoint.schema_id === "language"
      );
      if (languageDataPoint) {
        basicInfoSectionData.language = languageDataPoint.value;
        console.log("Language:", basicInfoSectionData.language);
      }
    }

    // Process amounts section
    if (amountsSection) {
      const amountTotalDataPoint = amountsSection.children.find(
        (datapoint: any) => datapoint.schema_id === "amount_total"
      );
      if (amountTotalDataPoint) {
        amountSectionData.amount_total = amountTotalDataPoint.value;
        console.log("Invoice Amount:", amountSectionData.amount_total);
      }

      const amountCurrencyDataPoint = amountsSection.children.find(
        (datapoint: any) => datapoint.schema_id === "currency"
      );
      if (amountCurrencyDataPoint) {
        amountSectionData.currency = amountCurrencyDataPoint.value;
        console.log("Invoice Currency:", amountSectionData.currency);
      }
    }

    // Process payment info section
    if (paymentInfoSection) {
      const bankNameDataPoint = paymentInfoSection.children.find(
        (datapoint: any) => datapoint.schema_id === "vendor_bank"
      );
      if (bankNameDataPoint) {
        paymentInfoSectionData.vendor_bank = bankNameDataPoint.value;
        console.log("Vendor Bank:", paymentInfoSectionData.vendor_bank);
      }

      const accountNumberDataPoint = paymentInfoSection.children.find(
        (datapoint: any) => datapoint.schema_id === "account_num"
      );
      if (accountNumberDataPoint) {
        paymentInfoSectionData.account_num = accountNumberDataPoint.value;
        console.log("Account Number:", paymentInfoSectionData.account_num);
      }
      
      const bankNumberDataPoint = paymentInfoSection.children.find(
        (datapoint: any) => datapoint.schema_id === "bank_num"
      );
      if (bankNumberDataPoint) {
        paymentInfoSectionData.bank_num = bankNumberDataPoint.value;
        console.log("Bank Number:", paymentInfoSectionData.bank_num);
      }
    }

    // Process vendor section
    if (vendorSection) {
      const vendorNameDataPoint = vendorSection.children.find(
        (datapoint: any) => datapoint.schema_id === "sender_name"
      );
      if (vendorNameDataPoint) {
        vendorSectionData.sender_name = vendorNameDataPoint.value;
        console.log("Vendor Name:", vendorSectionData.sender_name);
      }

      const vendorVATDataPoint = vendorSection.children.find(
        (datapoint: any) => datapoint.schema_id === "sender_ic"
      );
      if (vendorVATDataPoint) {
        vendorSectionData.sender_ic = vendorVATDataPoint.value;
        console.log("Vendor VAT ID:", vendorSectionData.sender_ic);
      }

      const vendorTaxDataPoint = vendorSection.children.find(
        (datapoint: any) => datapoint.schema_id === "sender_vat_id"
      );
      if (vendorTaxDataPoint) {
        vendorSectionData.sender_vat_id = vendorTaxDataPoint.value;
        console.log("Vendor Tax ID:", vendorSectionData.sender_vat_id);
      }

      const vendorEmailDataPoint = vendorSection.children.find(
        (datapoint: any) => datapoint.schema_id === "sender_email"
      );
      if (vendorEmailDataPoint) {
        vendorSectionData.sender_email = vendorEmailDataPoint.value;
        console.log("Vendor Email:", vendorSectionData.sender_email);
      }

      const vendorAddressStreetDataPoint = vendorSection.children.find(
        (datapoint: any) => datapoint.schema_id === "vendor_street"
      );
      if (vendorAddressStreetDataPoint) {
        vendorSectionData.vendor_street = vendorAddressStreetDataPoint.value;
        console.log("Vendor Address Street:", vendorSectionData.vendor_street);
      }

      const vendorAddressCityDataPoint = vendorSection.children.find(
        (datapoint: any) => datapoint.schema_id === "vendor_city"
      );
      if (vendorAddressCityDataPoint) {
        vendorSectionData.vendor_city = vendorAddressCityDataPoint.value;
        console.log("Vendor Address City:", vendorSectionData.vendor_city);
      }

      const vendorAddressZipDataPoint = vendorSection.children.find(
        (datapoint: any) => datapoint.schema_id === "vendor_zip"
      );
      if (vendorAddressZipDataPoint) {
        vendorSectionData.vendor_zip = vendorAddressZipDataPoint.value;
        console.log("Vendor Address Zip:", vendorSectionData.vendor_zip);
      }

      // TODO: Add recipient IC validation to ensure this is a recipient invoice
      const recipientIcDataPoint = vendorSection.children.find(
        (datapoint: any) => datapoint.schema_id === "recipient_ic"
      );
      if (recipientIcDataPoint) {
        vendorSectionData.recipient_ic = recipientIcDataPoint.value;
        console.log("Recipient IC:", vendorSectionData.recipient_ic);
      }
    }
  } else {
    console.log("No results found in the JSON data.");
  }

  // Store annotation data in S3 bucket
  console.log("Storing annotation data in S3...");
  const buffer = Buffer.from(JSON.stringify(data));
  const fileNameJSON = `rossum/invoice_annotation-${annotationId}.json`;

  const bucketParamsJSON = {
    Bucket: process.env.DO_BUCKET,
    Key: fileNameJSON,
    Body: buffer,
    ContentType: "application/json",
    ContentDisposition: "inline",
    ACL: "public-read" as const,
  };

  try {
    await s3Client.send(new PutObjectCommand(bucketParamsJSON));
    console.log("Successfully uploaded annotation to S3");
  } catch (error) {
    console.error("Failed to upload annotation to S3:", error);
    return NextResponse.json({ error: "Failed to store annotation data" }, { status: 500 });
  }

  // Generate S3 URL for the JSON file
  const urlJSON = `https://${process.env.DO_BUCKET}.${process.env.DO_REGION}.digitaloceanspaces.com/${fileNameJSON}`;
  console.log("S3 URL:", urlJSON);

  // Find the invoice record using the new Prisma schema (Invoices model)
  console.log("Finding invoice record...");
  const invoice = await prismadb.invoices.findFirst({
    where: {
      rossum_annotation_id: annotationId,
    },
  });

  if (!invoice) {
    return NextResponse.json({ error: "No invoice found" }, { status: 404 });
  }

  console.log("Found invoice:", invoice.id);
  console.log("Basic info data:", basicInfoSectionData);
  console.log("Amount data:", amountSectionData);
  console.log("Vendor data:", vendorSectionData);
  console.log("Payment info data:", paymentInfoSectionData);

  // Update invoice record with extracted data (using new field names)
  try {
    const updatedInvoice = await prismadb.invoices.update({
      where: {
        id: invoice.id,
      },
      data: {
        // Basic invoice information
        variable_symbol: basicInfoSectionData.document_id,
        date_of_case: basicInfoSectionData.date_issue,
        date_due: basicInfoSectionData.date_due,
        document_type: basicInfoSectionData.document_type,
        order_number: basicInfoSectionData.order_id,
        invoice_number: basicInfoSectionData.document_id,
        invoice_language: basicInfoSectionData.language,
        
        // Amount information
        invoice_amount: amountSectionData.amount_total,
        invoice_currency: amountSectionData.currency,
        
        // Partner/vendor information
        partner: vendorSectionData.sender_name,
        partner_business_street: vendorSectionData.vendor_street,
        partner_business_city: vendorSectionData.vendor_city,
        partner_business_zip: vendorSectionData.vendor_zip,
        partner_VAT_number: vendorSectionData.sender_ic,
        partner_TAX_number: vendorSectionData.sender_vat_id,
        partner_email: vendorSectionData.sender_email,
        
        // Banking information
        partner_bank: paymentInfoSectionData.vendor_bank,
        partner_account_number: paymentInfoSectionData.account_num,
        partner_account_bank_number: paymentInfoSectionData.bank_num,
        
        // Rossum-specific fields
        rossum_status: data.results[0].status,
        rossum_annotation_json_url: urlJSON,
        
        // Update timestamp
        last_updated: new Date(),
      },
    });

    console.log("Successfully updated invoice:", updatedInvoice.id);

    return NextResponse.json(
      { 
        message: "Invoice annotation processed successfully", 
        invoiceId: updatedInvoice.id,
        annotationUrl: urlJSON,
        data: data
      }, 
      { status: 200 }
    );

  } catch (error) {
    console.error("Failed to update invoice:", error);
    return NextResponse.json({ error: "Failed to update invoice record" }, { status: 500 });
  }
}