# Testfunction-Image fuer die Sandbox-Zertifizierung.
#
# Bewusst ohne USER-Direktive: Die Sandbox setzt `--user` selbst, und genau das
# soll geprueft werden. Ein USER im Image wuerde die Pruefung wertlos machen,
# weil sie dann auch bei fehlendem Flag bestuende.
FROM node:24-alpine

COPY handler.mjs /qkern/handler.mjs

ENTRYPOINT ["node", "/qkern/handler.mjs"]
