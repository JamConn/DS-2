import * as cdk from "aws-cdk-lib";
import * as lambdanode from "aws-cdk-lib/aws-lambda-nodejs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import * as events from "aws-cdk-lib/aws-lambda-event-sources";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";

import { Construct } from "constructs";

export class EDAAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // S3 bucket 
    const imagesBucket = new s3.Bucket(this, "images", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      publicReadAccess: false,
    });

    // DynamoDB table 
    const imagesTable = new dynamodb.Table(this, "ImagesTable", {
      partitionKey: { name: "fileName", type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // DLQ
    const badImagesQueue = new sqs.Queue(this, "bad-images-queue", {
      retentionPeriod: cdk.Duration.minutes(5),
    });

    
    const imageProcessQueue = new sqs.Queue(this, "image-process-queue", {
      deadLetterQueue: {
        queue: badImagesQueue,
        maxReceiveCount: 1, 
      },
      retentionPeriod: cdk.Duration.minutes(5),
    });


    const newImageTopic = new sns.Topic(this, "NewImageTopic", {
      displayName: "New Image topic",
    });

    // Log Image Lambda 
    const logImageFn = new lambdanode.NodejsFunction(this, "LogImageFn", {
      architecture: lambda.Architecture.ARM_64,
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: `${__dirname}/../lambdas/logImage.ts`,
      timeout: cdk.Duration.seconds(10),
      memorySize: 128,
      environment: {
        IMAGES_TABLE: imagesTable.tableName,
      },
    });


    imagesBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.SnsDestination(newImageTopic)
    );


newImageTopic.addSubscription(
  new subs.SqsSubscription(imageProcessQueue)
);

    // SQS 
    logImageFn.addEventSource(
      new events.SqsEventSource(imageProcessQueue, {
        batchSize: 5,
        maxBatchingWindow: cdk.Duration.seconds(5),
      })
    );


    imagesTable.grantWriteData(logImageFn);
    
    new cdk.CfnOutput(this, "BucketName", {
      value: imagesBucket.bucketName,
    });

    new cdk.CfnOutput(this, "ImagesTableName", {
      value: imagesTable.tableName,
    });
    new cdk.CfnOutput(this, "ImageProcessQueueUrl", {
      value: imageProcessQueue.queueUrl,
    });

    new cdk.CfnOutput(this, "BadImagesQueueUrl", {
      value: badImagesQueue.queueUrl,
    });
  }
}