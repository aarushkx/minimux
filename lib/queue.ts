import { Queue } from "bullmq";
import { redisConnection } from "./redis";

export const VIDEO_QUEUE_NAME = "video-transcode";
let queueInstance: Queue | undefined;

export function getVideoQueue() {
  if (!queueInstance) {
    queueInstance = new Queue(VIDEO_QUEUE_NAME, {
      connection: redisConnection(),
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: "exponential", delay: 10_000 },
        removeOnComplete: 50,
        removeOnFail: 50,
      },
    });
  }
  return queueInstance;
}
