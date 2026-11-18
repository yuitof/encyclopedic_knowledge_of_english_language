# This image is only for the standalone feasibility probe.
FROM public.ecr.aws/lambda/python:3.12@sha256:ca6bfddec7726813ba7251ac1a14c8aefbcc76b18343267c3b5f339c8db2c758 AS extract
COPY cloudflare-warp.rpm cloudflare-warp.gpg /input/
RUN --mount=type=secret,id=hostca,target=/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem \
    echo 'd6f0f6c56f35e5c7787385d807ebffc311e7aef40e52f59b069d030573074d15  /input/cloudflare-warp.rpm' | sha256sum -c - \
    && rpmkeys --import /input/cloudflare-warp.gpg \
    && rpmkeys -K /input/cloudflare-warp.rpm \
    && dnf install -y cpio rpm-build \
    && mkdir /warp \
    && cd /warp \
    && rpm2cpio /input/cloudflare-warp.rpm | cpio -id './bin/warp-svc' './bin/warp-cli'

FROM public.ecr.aws/lambda/python:3.12@sha256:ca6bfddec7726813ba7251ac1a14c8aefbcc76b18343267c3b5f339c8db2c758
RUN --mount=type=secret,id=hostca,target=/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem \
    dnf install -y dbus-daemon nss tpm2-tss \
    && dnf clean all
COPY --from=extract /warp/bin/ /usr/local/bin/
COPY probe.py ${LAMBDA_TASK_ROOT}/probe.py
CMD ["probe.handler"]
