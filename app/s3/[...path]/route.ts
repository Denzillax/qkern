import { getProjectStorageS3Endpoint } from "@/lib/server/project-storage/s3-endpoint-runtime";

/** S3-Endpunkt (2.96): `/s3/{bucket}` und `/s3/{bucket}/{key}`. */
const handle = (request: Request) => getProjectStorageS3Endpoint().handle(request);

export const GET = handle;
export const HEAD = handle;
export const PUT = handle;
export const POST = handle;
export const DELETE = handle;
