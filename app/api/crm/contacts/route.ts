// app/api/crm/contacts/route.ts (updated for Supabase)
import { NextResponse } from "next/server";
import { prismadb } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import sendEmail from "@/lib/sendmail";

//Create route
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return new NextResponse("Unauthenticated", { status: 401 });
  }
  try {
    const body = await req.json();
    const userId = session.user.id;

    if (!body) {
      return new NextResponse("No form data", { status: 400 });
    }

    const {
      assigned_to,
      assigned_account,
      birthday_day,
      birthday_month,
      birthday_year,
      description,
      email,
      personal_email,
      first_name,
      last_name,
      office_phone,
      mobile_phone,
      website,
      status,
      social_twitter,
      social_facebook,
      social_linkedin,
      social_skype,
      social_instagram,
      social_youtube,
      social_tiktok,
      type,
    } = body;

    const newContact = await prismadb.crm_Contacts.create({
      data: {
        v: 0,
        createdBy: userId,
        updatedBy: userId,
        // 🔴 CHANGED FOR SUPABASE: Use direct field assignment instead of nested connect
        // BEFORE (MongoDB): assigned_accounts: { connect: { id: assigned_account } }
        // AFTER (PostgreSQL): accountsIDs: assigned_account || null
        accountsIDs: assigned_account || null,
        
        // 🔴 CHANGED FOR SUPABASE: Use direct field assignment for user relationship
        // BEFORE (MongoDB): assigned_to_user: { connect: { id: assigned_to } }
        // AFTER (PostgreSQL): assigned_to: assigned_to
        assigned_to: assigned_to,
        
        birthday: birthday_day + "/" + birthday_month + "/" + birthday_year,
        description,
        email,
        personal_email,
        first_name,
        last_name,
        office_phone,
        mobile_phone,
        website,
        status,
        social_twitter,
        social_facebook,
        social_linkedin,
        social_skype,
        social_instagram,
        social_youtube,
        social_tiktok,
        type,
      },
    });

    // 🔴 EMAIL NOTIFICATION LOGIC UNCHANGED - Works with both MongoDB and PostgreSQL
    if (assigned_to !== userId) {
      const notifyRecipient = await prismadb.users.findFirst({
        where: {
          id: assigned_to,
        },
      });

      if (!notifyRecipient) {
        return new NextResponse("No user found", { status: 400 });
      }

      await sendEmail({
        from: process.env.EMAIL_FROM as string,
        to: notifyRecipient.email || "info@softbase.cz",
        subject:
          notifyRecipient.userLanguage === "en"
            ? `New contact ${first_name} ${last_name} has been added to the system and assigned to you.`
            : `Nový kontakt ${first_name} ${last_name} byla přidána do systému a přidělena vám.`,
        text:
          notifyRecipient.userLanguage === "en"
            ? `New contact ${first_name} ${last_name} has been added to the system and assigned to you. You can click here for detail: ${process.env.NEXT_PUBLIC_APP_URL}/crm/contacts/${newContact.id}`
            : `Nový kontakt ${first_name} ${last_name} byla přidán do systému a přidělena vám. Detaily naleznete zde: ${process.env.NEXT_PUBLIC_APP_URL}/crm/contact/${newContact.id}`,
      });
    }

    return NextResponse.json({ newContact }, { status: 200 });
  } catch (error) {
    console.log("[NEW_CONTACT_POST]", error);
    return new NextResponse("Initial error", { status: 500 });
  }
}

//Update route
export async function PUT(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return new NextResponse("Unauthenticated", { status: 401 });
  }
  try {
    const body = await req.json();
    const userId = session.user.id;

    if (!body) {
      return new NextResponse("No form data", { status: 400 });
    }

    const {
      id,
      assigned_account,
      assigned_to,
      birthday_day,
      birthday_month,
      birthday_year,
      description,
      email,
      personal_email,
      first_name,
      last_name,
      office_phone,
      mobile_phone,
      website,
      status,
      social_twitter,
      social_facebook,
      social_linkedin,
      social_skype,
      social_instagram,
      social_youtube,
      social_tiktok,
      type,
    } = body;

    const newContact = await prismadb.crm_Contacts.update({
      where: {
        id,
      },
      data: {
        v: 0,
        updatedBy: userId,
        // 🔴 CHANGED FOR SUPABASE: Same changes as in POST route
        // Direct field assignment instead of nested operations
        accountsIDs: assigned_account || null,
        assigned_to: assigned_to,
        
        birthday: birthday_day + "/" + birthday_month + "/" + birthday_year,
        description,
        email,
        personal_email,
        first_name,
        last_name,
        office_phone,
        mobile_phone,
        website,
        status,
        social_twitter,
        social_facebook,
        social_linkedin,
        social_skype,
        social_instagram,
        social_youtube,
        social_tiktok,
        type,
      },
    });

    return NextResponse.json({ newContact }, { status: 200 });
  } catch (error) {
    console.log("UPDATE_CONTACT_PUT]", error);
    return new NextResponse("Initial error", { status: 500 });
  }
}