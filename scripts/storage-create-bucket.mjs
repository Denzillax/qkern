// Legt den Provider-Bucket fuer die lokale Entwicklung an (2.14). versitygw hat
// keine Web-UI; dieses Skript signiert ein `PUT /<bucket>` nach SigV4 mit den
// Werten aus `docker-compose.yml` oder den QKERN_PROJECT_STORAGE_S3_*-Variablen.
// 200 heisst angelegt, 409 heisst schon vorhanden; beides ist in Ordnung.
import { createHash, createHmac } from "node:crypto";

const endpoint = process.env.QKERN_PROJECT_STORAGE_S3_ENDPOINT ?? "http://127.0.0.1:9000";
const region = process.env.QKERN_PROJECT_STORAGE_S3_REGION ?? "us-east-1";
const bucket = process.env.QKERN_PROJECT_STORAGE_S3_BUCKET ?? "qkern-project-storage";
const accessKeyId = process.env.QKERN_PROJECT_STORAGE_S3_ACCESS_KEY_ID ?? "qkern_local_access";
const secretAccessKey = process.env.QKERN_PROJECT_STORAGE_S3_SECRET_ACCESS_KEY ?? "qkern_local_password_change_me_32bytes";

const sha256Hex = (value) => createHash("sha256").update(value).digest("hex");
const hmac = (key, value) => createHmac("sha256", key).update(value, "utf8").digest();

const now = new Date();
const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
const day = amzDate.slice(0, 8);
const scope = `${day}/${region}/s3/aws4_request`;
const url = new URL(endpoint);
url.pathname = `/${bucket}`;
const payloadHash = sha256Hex("");
const canonicalHeaders = `host:${url.host.toLowerCase()}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
const canonicalRequest = ["PUT", url.pathname, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), "s3"), "aws4_request");
const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");

const response = await fetch(url, {
  method: "PUT",
  redirect: "error",
  headers: {
    host: url.host.toLowerCase(),
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  },
});
if (response.ok) {
  process.stdout.write(`Bucket ${bucket} angelegt unter ${endpoint}.\n`);
} else if (response.status === 409) {
  process.stdout.write(`Bucket ${bucket} ist unter ${endpoint} schon vorhanden.\n`);
} else {
  process.stderr.write(`Bucket ${bucket} nicht angelegt: HTTP ${response.status}\n${(await response.text()).slice(0, 400)}\n`);
  process.exitCode = 1;
}
