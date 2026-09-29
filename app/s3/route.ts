import { getProjectStorageS3Endpoint } from "@/lib/server/project-storage/s3-endpoint-runtime";

/**
 * S3-Endpunkt (2.96), Wurzel: ListBuckets. Pfadadressiert unter `/s3`; ein
 * Client bekommt `https://<qkern>/s3` als Endpunkt-URL. Alles andere steht in
 * lib/server/project-storage/s3-endpoint.ts.
 */
const handle = (request: Request) => getProjectStorageS3Endpoint().handle(request);

export const GET = handle;
export const HEAD = handle;
export const PUT = handle;
export const POST = handle;
export const DELETE = handle;
