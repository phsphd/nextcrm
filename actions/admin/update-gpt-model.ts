// file: nextcrm/actions/admin/update-gpt-model.ts  
/*This action updates the status of a GPT model in the database.
It first sets all GPT models to inactive and then sets the specified model to active.
*/  

"use server";

import { prismadb } from "@/lib/prisma";

const updateModel = async (model: any) => {
  await prismadb.gpt_models.updateMany({
    data: {
      status: "INACTIVE",
    },
  });

  const setCronGPT = await prismadb.gpt_models.update({
    where: {
      id: model,
    },
    data: {
      status: "ACTIVE",
    },
  });
  console.log("change GPT model to:", setCronGPT);
};

export default updateModel;
