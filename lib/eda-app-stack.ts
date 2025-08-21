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
import * as iam from "aws-cdk-lib/aws-iam";

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

    const metadataQueue = new sqs.Queue(this, "metadata-queue", {
      retentionPeriod: cdk.Duration.minutes(5),
    });

    const reviewQueue = new sqs.Queue(this, "review-queue", {
      retentionPeriod: cdk.Duration.minutes(5),
    });

    const mailerQueue = new sqs.Queue(this, "mailer-queue", {
      receiveMessageWaitTime: cdk.Duration.seconds(10),
    });


    const newImageTopic = new sns.Topic(this, "NewImageTopic", {
      displayName: "New Image topic",
    });
    

    const reviewTopic = new sns.Topic(this, "ReviewTopic", {
      displayName: "Image Review Completed topic",
    })

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



    const removeImageFn = new lambdanode.NodejsFunction(this, "RemoveImageFn", {
      architecture: lambda.Architecture.ARM_64,
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: `${__dirname}/../lambdas/removeImage.ts`,
      timeout: cdk.Duration.seconds(10),
      memorySize: 128,
      environment: {
        BUCKET_NAME: imagesBucket.bucketName,
      },
    });

    const addMetadataFn = new lambdanode.NodejsFunction(this, "AddMetadataFn", {
      architecture: lambda.Architecture.ARM_64,
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: `${__dirname}/../lambdas/addMetadata.ts`,
      timeout: cdk.Duration.seconds(10),
      memorySize: 128,
      environment: {
        IMAGES_TABLE: imagesTable.tableName,
      },
    });

    const updateStatusFn = new lambdanode.NodejsFunction(
      this,
      "UpdateStatusFn",
      {
        architecture: lambda.Architecture.ARM_64,
        runtime: lambda.Runtime.NODEJS_22_X,
        entry: `${__dirname}/../lambdas/updateStatus.ts`,
        timeout: cdk.Duration.seconds(10),
        memorySize: 128,
        environment: {
          IMAGES_TABLE: imagesTable.tableName,
        },
      }
    );
    updateStatusFn.addEnvironment("REVIEW_TOPIC_ARN", reviewTopic.topicArn);

    const confirmationMailerFn = new lambdanode.NodejsFunction(
      this,
      "ConfirmationMailerFn",
      {
        architecture: lambda.Architecture.ARM_64,
        runtime: lambda.Runtime.NODEJS_22_X,
        entry: `${__dirname}/../lambdas/confirmationMailer.ts`,
        timeout: cdk.Duration.seconds(10),
        memorySize: 128,
      }
    );


    imagesBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.SnsDestination(newImageTopic)
    );


   newImageTopic.addSubscription(
      new subs.SqsSubscription(imageProcessQueue)
    );

    newImageTopic.addSubscription(
      new subs.SqsSubscription(metadataQueue)
    );

    newImageTopic.addSubscription(
      new subs.SqsSubscription(reviewQueue)
    );

    reviewTopic.addSubscription(
      new subs.SqsSubscription(mailerQueue)
    );

 
    // SQS 
    logImageFn.addEventSource(
      new events.SqsEventSource(imageProcessQueue, {
        batchSize: 5,
        maxBatchingWindow: cdk.Duration.seconds(5),
      })
    );

    removeImageFn.addEventSource(
      new events.SqsEventSource(badImagesQueue, {
        batchSize: 5,
        maxBatchingWindow: cdk.Duration.seconds(5),
      })
    );

    addMetadataFn.addEventSource(
      new events.SqsEventSource(metadataQueue, {
        batchSize: 5,
        maxBatchingWindow: cdk.Duration.seconds(5),
      })
    );

    updateStatusFn.addEventSource(new events.SqsEventSource(reviewQueue, {
      batchSize: 5,
      maxBatchingWindow: cdk.Duration.seconds(5),
    }));

    const mailerEventSource = new events.SqsEventSource(mailerQueue, {
      batchSize: 5,
      maxBatchingWindow: cdk.Duration.seconds(5),
    });
    confirmationMailerFn.addEventSource(mailerEventSource);



    imagesTable.grantWriteData(logImageFn);
    imagesTable.grantReadWriteData(addMetadataFn);
    imagesTable.grantReadWriteData(updateStatusFn);
    imagesBucket.grantDelete(removeImageFn);
    reviewTopic.grantPublish(updateStatusFn);

    //mailer add role

    confirmationMailerFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["ses:SendEmail", "ses:SendRawEmail", "ses:SendTemplatedEmail"],
        resources: ["*"],
      })
    );
    
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

    new cdk.CfnOutput(this, "MetadataQueueUrl", { 
      value: metadataQueue.queueUrl 
    });

    new cdk.CfnOutput(this, "NewImageTopicArn", {
      value: newImageTopic.topicArn,
    });

    new cdk.CfnOutput(this, "ReviewQueueUrl", { 
      value: reviewQueue.queueUrl 
    });

    new cdk.CfnOutput(this, "MailerQueueUrl", 
      { value: mailerQueue.queueUrl }
    );

    new cdk.CfnOutput(this, "ReviewTopicArn", { 
      value: reviewTopic.topicArn }
    );


    
 
  }
}