import { SQSHandler } from "aws-lambda";
import * as path from "path";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

const REGION = process.env.AWS_REGION || "eu-west-1";
const TABLE_NAME = process.env.IMAGES_TABLE;
if (!TABLE_NAME) {
  throw new Error("IMAGES_TABLE environment variable not set");
}

const ddbClient = new DynamoDBClient({ region: REGION });
const docClient = DynamoDBDocumentClient.from(ddbClient);

export const handler: SQSHandler = async (event) => {
  try {
    console.log("Event: ", JSON.stringify(event));
    for (const record of event.Records) {

      const recordBody = JSON.parse(record.body);
      const snsMessage = JSON.parse(recordBody.Message);

      if (snsMessage.Records) {
        for (const messageRecord of snsMessage.Records) {
          const s3e = messageRecord.s3;
          const srcKey = decodeURIComponent(
            s3e.object.key.replace(/\+/g, " ")
          );

          const fileName = path.basename(srcKey);
          const ext = path.extname(fileName).toLowerCase();


          if (ext !== ".jpeg" && ext !== ".png") {
            console.log(`Invalid file type for ${fileName} -> ${ext}`);
           
            throw new Error(`Unsupported file extension: ${ext}`);
          }

          
          await docClient.send(
            new PutCommand({
              TableName: TABLE_NAME,
              Item: {
                fileName,
              },
            })
          );

          console.log(`Logged image ${fileName} into table ${TABLE_NAME}`);
        }
      } else {
       
        console.log("SNS message didn't contain Records, ignoring.");
      }
    }
  } catch (error) {
    console.log("ERROR in logImage handler:", error);
    
    throw new Error(JSON.stringify(error));
  }
};