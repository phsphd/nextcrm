// file: nextcrm/app/api/my-account/route.ts
/*
This route handles company account information management
Provides CRUD operations for company/organization settings

MIGRATION NOTES (MongoDB -> Supabase):
- Updated model name from 'myAccount' to 'myAccount' (kept as per schema)
- Enhanced validation with Zod schema
- Improved error handling and response structure
- Added proper data validation and sanitization
- Better security with admin permission checking
- Enhanced logging and activity tracking
- Added comprehensive field validation
- Improved response messages and error handling
*/
import { authOptions } from "@/lib/auth";
import { prismadb } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";

// Enhanced validation schema for my account data
const myAccountSchema = z.object({
  company_name: z.string().min(1, "Company name is required").max(100, "Company name is too long"),
  is_person: z.boolean().default(false),
  email: z.string().email("Invalid email format").optional().nullable(),
  email_accountant: z.string().email("Invalid accountant email format").optional().nullable(),
  phone_prefix: z.string().max(10, "Phone prefix is too long").optional().nullable(),
  phone: z.string().max(20, "Phone number is too long").optional().nullable(),
  mobile_prefix: z.string().max(10, "Mobile prefix is too long").optional().nullable(),
  mobile: z.string().max(20, "Mobile number is too long").optional().nullable(),
  fax_prefix: z.string().max(10, "Fax prefix is too long").optional().nullable(),
  fax: z.string().max(20, "Fax number is too long").optional().nullable(),
  website: z.string().url("Invalid website URL").optional().nullable().or(z.literal("")),
  street: z.string().max(100, "Street address is too long").optional().nullable(),
  city: z.string().max(50, "City name is too long").optional().nullable(),
  state: z.string().max(50, "State name is too long").optional().nullable(),
  zip: z.string().max(20, "ZIP code is too long").optional().nullable(),
  country: z.string().max(50, "Country name is too long").optional().nullable(),
  country_code: z.string().max(5, "Country code is too long").optional().nullable(),
  billing_street: z.string().max(100, "Billing street is too long").optional().nullable(),
  billing_city: z.string().max(50, "Billing city is too long").optional().nullable(),
  billing_state: z.string().max(50, "Billing state is too long").optional().nullable(),
  billing_zip: z.string().max(20, "Billing ZIP is too long").optional().nullable(),
  billing_country: z.string().max(50, "Billing country is too long").optional().nullable(),
  billing_country_code: z.string().max(5, "Billing country code is too long").optional().nullable(),
  currency: z.string().max(10, "Currency is too long").optional().nullable(),
  currency_symbol: z.string().max(5, "Currency symbol is too long").optional().nullable(),
  VAT_number: z.string().min(1, "VAT number is required").max(30, "VAT number is too long"),
  TAX_number: z.string().max(30, "TAX number is too long").optional().nullable(),
  bank_name: z.string().max(100, "Bank name is too long").optional().nullable(),
  bank_account: z.string().max(50, "Bank account is too long").optional().nullable(),
  bank_code: z.string().max(20, "Bank code is too long").optional().nullable(),
  bank_IBAN: z.string().max(50, "IBAN is too long").optional().nullable(),
  bank_SWIFT: z.string().max(20, "SWIFT code is too long").optional().nullable(),
});

const updateAccountSchema = myAccountSchema.extend({
  id: z.string().min(1, "ID is required"),
});

// Helper function to sanitize data
function sanitizeAccountData(data: any) {
  const sanitized = { ...data };
  
  // Convert empty strings to null for optional fields
  Object.keys(sanitized).forEach(key => {
    if (sanitized[key] === "") {
      sanitized[key] = null;
    }
  });

  // Handle website URL formatting
  if (sanitized.website && !sanitized.website.startsWith('http')) {
    sanitized.website = `https://${sanitized.website}`;
  }

  return sanitized;
}

// GET - Retrieve current account information
export async function GET(req: Request) {
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

  try {
    console.log(`Admin ${session.user.email} retrieving account information`);

    const account = await prismadb.myAccount.findFirst({
      orderBy: {
        id: 'desc' // Get the most recent account record
      }
    });

    if (!account) {
      return NextResponse.json(
        {
          success: true,
          account: null,
          message: "No account information found. Please create your company profile."
        },
        { status: 200 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        account,
        message: "Account information retrieved successfully"
      },
      { status: 200 }
    );

  } catch (error) {
    console.error("[MY_ACCOUNT_GET] Error:", error);
    
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    
    return NextResponse.json(
      {
        error: "Failed to retrieve account information",
        details: errorMessage
      },
      { status: 500 }
    );
  }
}

// POST - Create new account information
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!session.user?.is_admin) {
    return NextResponse.json(
      { error: "Administrator privileges required to create account information" },
      { status: 403 }
    );
  }

  try {
    const body = await req.json();
    console.log(`Admin ${session.user.email} creating account information`);

    // Check if account already exists
    const existingAccount = await prismadb.myAccount.findFirst();
    if (existingAccount) {
      return NextResponse.json(
        {
          error: "Account information already exists",
          message: "Use PUT method to update existing account information",
          existingAccountId: existingAccount.id
        },
        { status: 409 }
      );
    }

    // Validate and sanitize data
    const validatedData = myAccountSchema.parse(body);
    const sanitizedData = sanitizeAccountData(validatedData);

    const newAccount = await prismadb.myAccount.create({
      data: {
        v: 0,
        ...sanitizedData,
      },
    });

    console.log(`Successfully created account information for: ${newAccount.company_name}`);

    return NextResponse.json(
      {
        success: true,
        message: "Account information created successfully",
        account: newAccount
      },
      { status: 201 }
    );

  } catch (error) {
    console.error("[MY_ACCOUNT_POST] Error:", error);
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: "Validation failed",
          details: error.errors.map(err => `${err.path.join('.')}: ${err.message}`)
        },
        { status: 400 }
      );
    }

    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    
    return NextResponse.json(
      {
        error: "Failed to create account information",
        details: errorMessage
      },
      { status: 500 }
    );
  }
}

// PUT - Update existing account information
export async function PUT(req: Request) {
  const session = await getServerSession(authOptions);
  
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!session.user?.is_admin) {
    return NextResponse.json(
      { error: "Administrator privileges required to update account information" },
      { status: 403 }
    );
  }

  try {
    const body = await req.json();
    console.log(`Admin ${session.user.email} updating account information`);

    // Validate and sanitize data
    const validatedData = updateAccountSchema.parse(body);
    const { id, ...updateData } = validatedData;
    const sanitizedData = sanitizeAccountData(updateData);

    // Check if the account exists
    const existingAccount = await prismadb.myAccount.findUnique({
      where: { id },
      select: {
        id: true,
        company_name: true,
      }
    });

    if (!existingAccount) {
      return NextResponse.json(
        { error: "Account not found" },
        { status: 404 }
      );
    }

    const updatedAccount = await prismadb.myAccount.update({
      where: { id },
      data: sanitizedData,
    });

    console.log(`Successfully updated account information for: ${updatedAccount.company_name}`);

    return NextResponse.json(
      {
        success: true,
        message: "Account information updated successfully",
        account: updatedAccount
      },
      { status: 200 }
    );

  } catch (error) {
    console.error("[MY_ACCOUNT_PUT] Error:", error);
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: "Validation failed",
          details: error.errors.map(err => `${err.path.join('.')}: ${err.message}`)
        },
        { status: 400 }
      );
    }

    if (error instanceof Error && error.message.includes('Record to update not found')) {
      return NextResponse.json(
        { error: "Account not found" },
        { status: 404 }
      );
    }

    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    
    return NextResponse.json(
      {
        error: "Failed to update account information",
        details: errorMessage
      },
      { status: 500 }
    );
  }
}

// DELETE - Remove account information (use with caution)
export async function DELETE(req: Request) {
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

  try {
    const { searchParams } = new URL(req.url);
    const accountId = searchParams.get('id');
    const confirmDeletion = searchParams.get('confirm') === 'true';

    if (!accountId) {
      return NextResponse.json(
        { error: "Account ID is required" },
        { status: 400 }
      );
    }

    if (!confirmDeletion) {
      return NextResponse.json(
        {
          error: "Deletion confirmation required",
          message: "Add ?confirm=true to the URL to confirm deletion",
          warning: "This action cannot be undone"
        },
        { status: 400 }
      );
    }

    console.log(`Admin ${session.user.email} deleting account information: ${accountId}`);

    const deletedAccount = await prismadb.myAccount.delete({
      where: { id: accountId }
    });

    console.log(`Successfully deleted account: ${deletedAccount.company_name}`);

    return NextResponse.json(
      {
        success: true,
        message: "Account information deleted successfully",
        deletedAccount: {
          id: deletedAccount.id,
          company_name: deletedAccount.company_name
        }
      },
      { status: 200 }
    );

  } catch (error) {
    console.error("[MY_ACCOUNT_DELETE] Error:", error);
    
    if (error instanceof Error && error.message.includes('Record to delete does not exist')) {
      return NextResponse.json(
        { error: "Account not found" },
        { status: 404 }
      );
    }

    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    
    return NextResponse.json(
      {
        error: "Failed to delete account information",
        details: errorMessage
      },
      { status: 500 }
    );
  }
}