import { SQSHandler } from "aws-lambda";
import {
  SESClient,
  SendEmailCommand,
  SendEmailCommandInput,
} from "@aws-sdk/client-ses";
import { SES_EMAIL_FROM, SES_EMAIL_TO, SES_REGION } from "../env";

if (!SES_EMAIL_FROM || !SES_EMAIL_TO || !SES_REGION) {
  throw new Error("Please set SES_EMAIL_FROM, SES_EMAIL_TO, SES_REGION in env.ts");
}

const client = new SESClient({ region: SES_REGION });

type ContactDetails = {
  subject: string;
  message: string;
};

export const handler: SQSHandler = async (event) => {
  console.log("Confirmation Mailer event:", JSON.stringify(event));

  for (const record of event.Records) {
    try {
      const recordBody = JSON.parse(record.body);
      const snsMessage = JSON.parse(recordBody.Message);

      const { id, update } = snsMessage;
      if (!id || !update?.status || !update?.reason) {
        console.log("Skipping mail send due to missing fields");
        continue;
      }

      const contactDetails: ContactDetails = {
        subject: `Your image ${id} review status`,
        message: `Your image "${id}" has been reviewed.<br/>
                  <b>Status:</b> ${update.status}<br/>
                  <b>Reason:</b> ${update.reason}`,
      };

      const params: SendEmailCommandInput = {
        Source: SES_EMAIL_FROM,
        Destination: { ToAddresses: [SES_EMAIL_TO] },
        Message: {
          Subject: { Charset: "UTF-8", Data: contactDetails.subject },
          Body: {
            Html: { Charset: "UTF-8", Data: getHtmlContent(contactDetails) },
          },
        },
      };
      await client.send(new SendEmailCommand(params));
      console.log(`Sent email for image ${id}`);
    } catch (error) {
      console.error("SES send error:", error);
    }
  }
};

function getHtmlContent({ subject, message }: ContactDetails) {
  return `
    <html>
      <body>
        <h2>${subject}</h2>
        <p style="font-size:16px; line-height:1.5;">${message}</p>
      </body>
    </html>
  `;
}