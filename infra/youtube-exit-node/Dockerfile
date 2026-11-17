FROM tailscale/tailscale:v1.104.7@sha256:72c1e19e0aedca96b8533bbb0b4368564410ff20b17e53b804eb6c1f04a31be4 AS tailscale
FROM public.ecr.aws/lambda/python:3.12@sha256:ca6bfddec7726813ba7251ac1a14c8aefbcc76b18343267c3b5f339c8db2c758
COPY --from=tailscale /usr/local/bin/tailscale /usr/local/bin/tailscale
COPY --from=tailscale /usr/local/bin/tailscaled /usr/local/bin/tailscaled
COPY tools/youtube/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt
COPY tools/youtube/tailscale_node.py tools/youtube/exit_jobs.py tools/youtube/exit_probe.py ${LAMBDA_TASK_ROOT}/
COPY infra/youtube-exit-node/worker.py ${LAMBDA_TASK_ROOT}/
CMD ["worker.handler"]
