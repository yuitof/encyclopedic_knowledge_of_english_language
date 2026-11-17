FROM gogost/gost:3.3.3@sha256:f266f957c6e4f8d433ed23202a5745fa4969d08f3f0ef034fb9357345e16ad67 AS gost
FROM tailscale/tailscale:v1.104.7@sha256:72c1e19e0aedca96b8533bbb0b4368564410ff20b17e53b804eb6c1f04a31be4 AS tailscale
FROM public.ecr.aws/lambda/python:3.12@sha256:ca6bfddec7726813ba7251ac1a14c8aefbcc76b18343267c3b5f339c8db2c758
COPY --from=gost /bin/gost /usr/local/bin/gost
COPY --from=tailscale /usr/local/bin/tailscale /usr/local/bin/tailscale
COPY --from=tailscale /usr/local/bin/tailscaled /usr/local/bin/tailscaled
COPY GOST-LICENSE /usr/share/licenses/gost/LICENSE
COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt
COPY tailscale_node.py sessions.py proxy.py worker.py ${LAMBDA_TASK_ROOT}/
CMD ["worker.handler"]
