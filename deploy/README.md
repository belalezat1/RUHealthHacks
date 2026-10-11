# EC2 deployment

The server checks the public `belal` branch every 60 seconds. A new commit builds
one Docker image containing the frontend and API, runs migrations, restarts the
application, and checks readiness. Refresh the website after the build completes
to load changes. No GitHub token is needed.

The managed checkout is `/opt/sevaro/repo`. Do not edit it on the server: a deploy
checks out the branch commit. Runtime credentials stay in the root-owned,
mode-600 `/etc/sevaro/backend.env`, outside Git and the image.

## Initial installation

1. Install Docker, git, curl, util-linux (`flock`), nginx and systemd on the EC2 host.
2. Configure nginx to proxy the whole site to `http://127.0.0.1:8000`. Provide HTTPS
   at the public entry point; hosted sessions use secure cookies.
3. Create `/etc/sevaro/backend.env` with the real server configuration:

   ```dotenv
   SEVARO_MODE=hosted
   SEVARO_IDENTITY_MODE=provisioned_sessions
   SEVARO_ALLOWED_ORIGINS=https://YOUR-PUBLIC-HOSTNAME
   SEVARO_DATABASE_URL=postgresql://APP_USER:URL_ENCODED_PASSWORD@RDS_HOST:5432/sevaro?sslmode=verify-full
   SEVARO_AUTO_MIGRATE=false
   SEVARO_POLICY_MODE=challenge
   SEVARO_JEV_ENABLED=false
   ```

   Use the application database user's credential. For live Jev, set
   `SEVARO_JEV_ENABLED=true` and add `TYPESAFE_API_KEY` to this file. Never print
   credentials or commit this file. The Docker image includes the RDS CA bundle.
4. Push the tested Dockerfile and deployment files to `belal`, then run from a
   checkout containing these files:

   ```bash
   sudo bash deploy/install.sh
   ```

5. Provision each application account through the admin command. It prompts for
   the password privately; the application ships without default credentials.

   ```bash
   sudo docker exec -it sevaro python -m backend.api.admin create-user \
     --username YOUR_USERNAME --name 'Your Name' --role coordinator
   ```

## Operations

```bash
sudo systemctl status sevaro-deploy.timer
sudo journalctl -u sevaro-deploy.service -n 80 --no-pager
sudo docker logs --tail 80 sevaro
curl --fail http://127.0.0.1:8000/health/ready
```

Deploy immediately with `sudo systemctl start sevaro-deploy.service`. To rebuild
the same commit after changing server environment, run
`sudo /usr/local/bin/sevaro-deploy --force`. Pause automatic updates with
`sudo systemctl stop sevaro-deploy.timer`.

Build or migration failures leave the serving container in place. If a new
container fails readiness, the previous container is restarted. A successful
restart causes a brief interruption; the previous container/image is retained.
Container rollback does **not** undo database migrations, so migrations must remain
compatible with the previous application release. This setup has one server;
it does not provide high availability or blue/green deployment.

Deploy logs appear in the systemd journal and application logs in Docker, rotated
at 10 MB with three files. Changes to the installed updater/service files require
running `deploy/install.sh` again. Images accumulate for rollback; periodically
remove unneeded old images while retaining the current and previous release.
