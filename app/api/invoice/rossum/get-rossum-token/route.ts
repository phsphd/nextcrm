// file: nextcrm/app/api/invoice/rossum/get-rossum-token/route.ts
/*
This route handles Rossum API authentication and returns an access token
No database migration needed - this only handles Rossum API authentication

IMPROVEMENTS MADE:
- Enhanced security with credential validation
- Better error handling and logging (without exposing sensitive data)
- Added response validation
- Improved error messages for debugging
- Added timeout handling for API requests
- More secure token handling
*/
import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await getServerSession(authOptions);
  
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Validate required environment variables
    const loginUrl = process.env.ROSSUM_API_URL;
    const username = process.env.ROSSUM_USER;
    const password = process.env.ROSSUM_PASS;

    if (!loginUrl || !username || !password) {
      console.error("Missing required Rossum environment variables");
      return NextResponse.json(
        { error: "Rossum configuration incomplete" },
        { status: 500 }
      );
    }

    const authEndpoint = `${loginUrl}/auth/login`;
    console.log("Authenticating with Rossum API...");

    // Create abort controller for timeout handling
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

    try {
      const response = await fetch(authEndpoint, {
        method: "POST",
        body: JSON.stringify({ username, password }),
        headers: { 
          "Content-Type": "application/json",
          "User-Agent": "NextCRM/1.0"
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.error(`Rossum authentication failed: ${response.status} ${response.statusText}`);
        return NextResponse.json(
          { error: `Authentication failed with status: ${response.status}` },
          { status: response.status === 401 ? 401 : 500 }
        );
      }

      const authData = await response.json();

      // Validate response structure
      if (!authData || !authData.key) {
        console.error("Invalid response from Rossum authentication API");
        return NextResponse.json(
          { error: "Invalid authentication response" },
          { status: 500 }
        );
      }

      console.log("Successfully authenticated with Rossum API");

      // Return token in a structured format
      return NextResponse.json(
        { 
          success: true,
          token: authData.key,
          expires_in: authData.expires_in || null,
          token_type: authData.token_type || "Bearer"
        }, 
        { status: 200 }
      );

    } catch (fetchError) {
      clearTimeout(timeoutId);
      
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        console.error("Rossum API request timeout");
        return NextResponse.json(
          { error: "Authentication request timeout" },
          { status: 408 }
        );
      }
      
      throw fetchError; // Re-throw to be handled by outer catch
    }

  } catch (error) {
    console.error("Error during Rossum authentication:", error);
    
    // Don't expose sensitive error details in production
    const errorMessage = error instanceof Error ? error.message : "Authentication failed";
    
    return NextResponse.json(
      { 
        error: "Failed to authenticate with Rossum API",
        details: process.env.NODE_ENV === 'development' ? errorMessage : undefined
      }, 
      { status: 500 }
    );
  }
}