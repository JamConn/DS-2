import { SQSHandler } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";

const REGION = process.env.AWS_REGION || "eu-west-1";
const TABLE_NAME = process.env.IMAGES_TABLE;
const REVIEW_TOPIC_ARN = process.env.REVIEW_TOPIC_ARN;

if (!TABLE_NAME) {
  throw new Error("IMAGES_TABLE environment variable not set");
}
if (!REVIEW_TOPIC_ARN) {
  throw new Error("REVIEW_TOPIC_ARN environment variable not set");
}

const ddbClient = new DynamoDBClient({ region: REGION });
const docClient = DynamoDBDocumentClient.from(ddbClient);
const snsClient = new SNSClient({ region: REGION });

const VALID_STATUS = ["Pass", "Reject"];

export const handler: SQSHandler = async (event) => {
  console.log("Review event: ", JSON.stringify(event));

  for (const record of event.Records) {
    try {
      const body = JSON.parse(record.body);
      const snsMessage = JSON.parse(body.Message); // SNS wraps the message

      const { id, date, update } = snsMessage;

      if (!id || !update?.status || !update?.reason) {
        console.log("Skipping message due to missing fields");
        continue;
      }

      if (!VALID_STATUS.includes(update.status)) {
        console.log(`Invalid status: ${update.status}, skipping`);
        continue;
      }

      // Update DynamoDB
      await docClient.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { fileName: id },
          UpdateExpression:
            "SET #status = :status, #reason = :reason, #date = :date",
          ExpressionAttributeNames: {
            "#status": "status",
            "#reason": "reason",
            "#date": "reviewDate",
          },
          ExpressionAttributeValues: {
            ":status": update.status,
            ":reason": update.reason,
            ":date": date,
          },
        })
      );

      console.log(
        `Updated ${id} with status ${update.status} and reason: ${update.reason}`
      );

      const messageForMailer = JSON.stringify({ id, date, update });
      await snsClient.send(
        new PublishCommand({
          TopicArn: REVIEW_TOPIC_ARN,
          Message: messageForMailer,
        })
      );
      console.log(`Published review event for ${id} to ReviewTopic`);
    } catch (err) {
      console.error("ERROR in updateStatus handler for record:", err);
    }
  }
};