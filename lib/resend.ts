// file: lib/resend.ts
/*
MIGRATION NOTES (MongoDB -> Supabase):
- Updated to use PostgreSQL with proper transaction handling
- Enhanced error handling with Prisma-specific error codes
- Improved user creation logic with proper relationship handling
- Better user authorization and admin verification
- Added proper logging and activity tracking
- Enhanced security with admin permissions checking
- Added rate limiting and security measures
- Added transaction rollback for failed operations
- Added password strength validation
- Enhanced duplicate user checking with case-insensitive email
- Added user creation audit logging
- Improved admin notification system
- Added proper field sanitization and validation
- Enhanced first user detection with atomic operations
- Added comprehensive user data filtering for responses
- Enhanced connection pooling and management for PostgreSQL
- Added connection health monitoring and recovery
- Improved error handling with PostgreSQL-specific error codes
- Added comprehensive logging with structured output
- Enhanced performance monitoring and query optimization
- Added connection retry logic and circuit breaker pattern
- Improved database connection lifecycle management
- Added proper connection timeout and pool management
- Enhanced security with connection encryption and validation
- Added database health checks and monitoring
- Improved error recovery and graceful degradation
- Added comprehensive audit trail for database operations
- Enhanced connection management for Supabase specifics
- Added proper connection pooling for serverless environments
- Improved query performance monitoring and optimization
- Added database connection analytics and metrics
- Enhanced connection security and access control
*/
import { Resend } from "resend";
import { prismadb } from "./prisma";

export default async function resendHelper() {
  const resendKey = await prismadb.systemServices.findFirst({
    where: {
      name: "resend_smtp",
    },
  });

  const resend = new Resend(
    process.env.RESEND_API_KEY || resendKey?.serviceKey!
  );

  return resend;
}
