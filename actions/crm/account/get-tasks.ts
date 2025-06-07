// actions/crm/account/get-tasks.ts
/*
This action gets all tasks for a specific account.
It first finds the user and then finds the tasks data.
*/
import { prismadb } from "@/lib/prisma";

export const getAccountsTasks = async (accountId: string) => {
  const data = await prismadb.crm_Accounts_Tasks.findMany({
    where: {
      account: accountId,
    },
    include: {
      assigned_user: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });
  return data;
};
