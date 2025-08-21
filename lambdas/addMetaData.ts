import { SQSHandler } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const REGION = process.env.AWS_REGION || "eu-west-1";
const TABLE_NAME = process.env.IMAGES_TABLE;
if (!TABLE_NAME) {
  throw new Error("IMAGES_TABLE environment variable not set");
}

const ddbClient = new DynamoDBClient({ region: REGION });
const docClient = DynamoDBDocumentClient.from(ddbClient);

const VALID_ATTRIBUTES = ["Caption", "Date", "name"];

export const handler: SQSHandler = async (event) => {
  try {
    console.log("Metadata event: ", JSON.stringify(event));

    for (const record of event.Records) {
      const body = JSON.parse(record.body);         
      const snsMessage = JSON.parse(body.Message);  //broke message up separate

      const { id, value } = snsMessage;

      const metadataTypeAttr = body.MessageAttributes?.metadata_type?.Value;

      if (!id || !value || !metadataTypeAttr) {
        console.log("Skipping message due to missing fields");
        continue;
      }

      if (!VALID_ATTRIBUTES.includes(metadataTypeAttr)) {
        console.log(`Invalid metadata_type: ${metadataTypeAttr}, skipping`);
        continue;
      }

      await docClient.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { fileName: id },
          UpdateExpression: "SET #attr = :val",
          ExpressionAttributeNames: { "#attr": metadataTypeAttr },
          ExpressionAttributeValues: { ":val": value },
        })
      );

      console.log(`Updated ${id} with ${metadataTypeAttr}: ${value}`);
    }
  } catch (err) {
    console.error("ERROR in addMetadata handler:", err);
    throw err;
  }
};