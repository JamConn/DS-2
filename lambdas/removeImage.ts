import { SQSHandler } from "aws-lambda";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";


const REGION = process.env.AWS_REGION || "eu-west-1";
const BUCKET_NAME = process.env.BUCKET_NAME;
if (!BUCKET_NAME) {
  throw new Error("BUCKET_NAME environment variable not set");
}


const s3Client = new S3Client({ region: REGION });


export const handler: SQSHandler = async (event) => {
  try {
    console.log("DLQ Event received in removeImage:", JSON.stringify(event));

    for (const record of event.Records) {
      const body = JSON.parse(record.body);
      const snsMessage = JSON.parse(body.Message);

      if (snsMessage.Records) {
        for (const messageRecord of snsMessage.Records) {
          const s3e = messageRecord.s3;
          const srcKey = decodeURIComponent(s3e.object.key.replace(/\+/g, " "));


          console.log(`Deleting invalid file: ${srcKey}`);
          await s3Client.send(
            new DeleteObjectCommand({
              Bucket: BUCKET_NAME,
              Key: srcKey,
            })
          );
          console.log(`Deleted ${srcKey} from ${BUCKET_NAME}`);
        }
      } else {
        console.log("SNS message didn't contain Records, ignoring.");
      }
    }
  } catch (err) {

    console.error("ERROR in removeImage handler:", err);
    throw err;
  }
};