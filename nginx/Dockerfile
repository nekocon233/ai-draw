FROM nginx:alpine

COPY nginx/docker-entrypoint.sh /docker-entrypoint.sh
COPY nginx/nginx.conf.template /etc/nginx/nginx.conf.template

RUN chmod +x /docker-entrypoint.sh

ENTRYPOINT ["/docker-entrypoint.sh"]
