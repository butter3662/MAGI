# 라즈베리파이에서 할 일 (MAGI 개인 서버)

라즈베리파이 4에 FreeLLMAPI와 문지기(pi-gateway)를 올리고, Tailscale Funnel로 문지기만 공개하는 순서다.
모든 경로를 그대로 적었다.

## 이 안내서의 약속

- Raspberry Pi Imager에서 **사용자 이름을 `pi`**, **호스트 이름을 `magi-pi`**로 만들었다고 가정한다.
  - 다르게 만들었다면 아래의 `/home/pi`를 `/home/내사용자이름`으로, `magi-pi`를 내 호스트 이름으로 바꿔 읽는다.
- 회색 상자 안의 명령은 **파이에 SSH로 접속한 터미널**에 한 줄씩 붙여 넣는다.
- `<tailnet>`은 Tailscale이 정해 주는 내 네트워크 이름이다. 4단계에서 확인한다.

## 다 끝나면 생기는 것

| 무엇 | 경로·주소 | 누가 볼 수 있나 |
|---|---|---|
| FreeLLMAPI 설치 폴더 | `/home/pi/freellmapi` | 파이 안 |
| FreeLLMAPI 암호화 키 | `/home/pi/freellmapi/.env` | 파이 안 |
| FreeLLMAPI 데이터(회사 키 등) | Docker 볼륨 `freellmapi_freellmapi-data` (`/var/lib/docker/volumes/freellmapi_freellmapi-data/_data`) | 파이 안 |
| FreeLLMAPI 주소 | `http://127.0.0.1:3001` | 파이 안 |
| FreeLLMAPI 관리 화면 | `https://magi-pi.<tailnet>.ts.net:8443` | 내 Tailscale 기기만 |
| MAGI 저장소 사본 | `/home/pi/MAGI` | 파이 안 |
| 문지기 프로그램 | `/opt/magi-gateway/gateway.mjs` | 파이 안 |
| 문지기 설정(통합 키 포함) | `/etc/magi-gateway.env` | 파이 안 |
| 문지기 서비스 파일 | `/etc/systemd/system/magi-gateway.service` | 파이 안 |
| 문지기 주소 | `http://127.0.0.1:8787` | 파이 안 |
| 공개 주소 (MAGI가 쓰는 주소) | `https://magi-pi.<tailnet>.ts.net` | 인터넷 (문지기만) |
| Docker 로그 크기 설정 | `/etc/docker/daemon.json` | 파이 안 |

---

## 0단계. 파이에 접속하기

PC 터미널이나 아이패드 SSH 앱(Termius 등)에서 접속한다.

```bash
ssh pi@magi-pi.local
```

접속되면 지금 위치를 확인한다.

```bash
pwd
```

`/home/pi`가 나오면 맞다.

---

## 1단계. 시스템 업데이트와 필요한 프로그램 설치

```bash
sudo apt update
sudo apt full-upgrade -y
sudo apt install -y git openssl curl nodejs
```

Node.js가 제대로 깔렸는지 확인한다.

```bash
node -v
which node
```

- `node -v`가 `v18` 이상이면 된다.
- `which node`가 **`/usr/bin/node`**여야 한다. 다른 경로가 나오면 6-4에서 서비스 파일의 `ExecStart` 경로를 그 값으로 바꾼다.

업데이트 뒤 한 번 재부팅한다.

```bash
sudo reboot
```

1~2분 뒤 0단계처럼 다시 접속한다.

---

## 2단계. Docker 설치

### 2-1. 설치 스크립트를 받아서 실행

```bash
curl -fsSL https://get.docker.com -o /home/pi/get-docker.sh
sudo sh /home/pi/get-docker.sh
```

### 2-2. `pi` 사용자가 sudo 없이 Docker를 쓰게 하기

```bash
sudo usermod -aG docker pi
exit
```

`exit`으로 접속이 끊기면 0단계처럼 **다시 접속**한다. (그룹 변경은 다시 로그인해야 적용된다.)

### 2-3. 동작 확인

```bash
docker run --rm hello-world
```

`Hello from Docker!`가 나오면 성공이다.

### 2-4. Docker 로그 크기 제한 (SD 카드 보호)

로그가 끝없이 쌓이면 SD 카드 수명이 줄어드니 크기를 제한한다.

```bash
sudo nano /etc/docker/daemon.json
```

아래 내용을 그대로 붙여 넣는다.

```json
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
```

nano 저장: `Ctrl + O` → `Enter`, 나가기: `Ctrl + X`

```bash
sudo systemctl restart docker
```

설치 스크립트 파일은 지워도 된다.

```bash
rm /home/pi/get-docker.sh
```

---

## 3단계. FreeLLMAPI 설치 (파이 안에서만 열림)

### 3-1. 내려받기

```bash
git clone --depth 1 https://github.com/tashfeenahmed/freellmapi.git /home/pi/freellmapi
cd /home/pi/freellmapi
```

### 3-2. 암호화 키 만들기

```bash
printf "ENCRYPTION_KEY=%s\nPORT=3001\n" "$(openssl rand -hex 32)" > /home/pi/freellmapi/.env
chmod 600 /home/pi/freellmapi/.env
cat /home/pi/freellmapi/.env
```

화면에 나온 `ENCRYPTION_KEY=...` 값을 **따로 안전한 곳에 적어 둔다.** 이 키를 잃어버리면 FreeLLMAPI에 저장한 회사 키를 풀 수 없다.

> `/home/pi/freellmapi/.env`에 **`HOST_BIND=0.0.0.0`은 절대 넣지 않는다.** 넣으면 관리 화면이 집 네트워크 전체에 열린다.

### 3-3. 실행

```bash
cd /home/pi/freellmapi
docker compose pull
docker compose up -d
```

### 3-4. 확인

```bash
docker compose ps
```

`freellmapi`의 STATUS가 `Up`(잠시 뒤 `healthy`)이면 된다.

```bash
sudo ss -ltnp | grep 3001
```

**`127.0.0.1:3001`**만 보여야 한다. `0.0.0.0:3001`이나 `*:3001`이 보이면 3-2의 `.env`를 다시 확인한다.

```bash
curl -sI http://127.0.0.1:3001/ | head -1
```

`HTTP/1.1`로 시작하는 줄이 나오면 켜져 있는 것이다.

데이터가 저장되는 실제 위치를 확인해 둔다.

```bash
docker volume inspect freellmapi_freellmapi-data --format '{{ .Mountpoint }}'
```

`/var/lib/docker/volumes/freellmapi_freellmapi-data/_data`가 나온다.

---

## 4단계. Tailscale 설치와 관리 화면 연결 (내 기기에서만)

### 4-1. 설치

```bash
curl -fsSL https://tailscale.com/install.sh -o /home/pi/tailscale-install.sh
sudo sh /home/pi/tailscale-install.sh
rm /home/pi/tailscale-install.sh
```

### 4-2. 로그인

```bash
sudo tailscale up
```

화면에 나온 `https://login.tailscale.com/...` 링크를 휴대폰이나 아이패드에서 열고 내 Tailscale 계정으로 로그인한다.

```bash
tailscale status
```

첫 줄에 `magi-pi`가 보이면 등록된 것이다.

### 4-3. 관리 화면을 내 Tailscale 기기에만 연결 (Serve, 비공개)

```bash
sudo tailscale serve --bg --https=8443 http://127.0.0.1:3001
```

- 처음이면 HTTPS 인증서 사용을 허가하라는 링크가 나온다. 링크를 열어 허가하고, 같은 명령을 한 번 더 실행한다.

```bash
sudo tailscale serve status
```

`https://magi-pi.<tailnet>.ts.net:8443`처럼 나온다. **여기서 `<tailnet>` 부분(예: `tail1234`)이 내 네트워크 이름이다.** 적어 둔다.

> 이 8443 주소는 **Serve(비공개)**라서 내 Tailscale 계정에 로그인된 기기에서만 열린다. 인터넷에는 공개되지 않는다.

---

## 5단계. FreeLLMAPI 관리 화면 설정 (브라우저)

이 단계만 파이가 아니라 아이패드나 PC 브라우저에서 한다.

### 5-1. 브라우저 기기에 Tailscale 앱 설치

아이패드·PC에 Tailscale 앱을 설치하고 **4-2와 같은 계정**으로 로그인한 뒤 켠다.

### 5-2. 관리 화면 열기

브라우저에서 `https://magi-pi.<tailnet>.ts.net:8443`을 연다.

### 5-3. 첫 계정 만들기

이메일·비밀번호로 관리자 계정을 만든다. **설치 코드(setup code)**를 물으면 파이 터미널에서 확인한다.

```bash
cd /home/pi/freellmapi
docker compose logs freellmapi | grep -i "setup code"
```

`First-run setup code: ...`의 값을 입력한다.

### 5-4. 회사 API 키 넣기

**Keys** 페이지에서 쓸 회사의 키를 넣는다. 공식 회사(Google AI Studio, Groq, Mistral, NVIDIA, Cloudflare 등)부터 넣는 것을 권한다.

### 5-5. 통합 키 복사

**Keys** 페이지 위쪽의 **통합 키**(`freellmapi-`로 시작)를 복사해 둔다. 6-3에서 쓴다.

---

## 6단계. 문지기(pi-gateway) 설치

### 6-1. MAGI 저장소 내려받기

```bash
git clone --depth 1 https://github.com/butter3662/MAGI.git /home/pi/MAGI
ls /home/pi/MAGI/pi-gateway
```

`gateway.mjs`, `magi-gateway.service`, `magi-gateway.env.example`, `README.md`가 보이면 된다.

### 6-2. 문지기 전용 사용자와 폴더 만들기

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin magigw
sudo mkdir -p /opt/magi-gateway
sudo cp /home/pi/MAGI/pi-gateway/gateway.mjs /opt/magi-gateway/gateway.mjs
sudo cp /home/pi/MAGI/pi-gateway/magi-gateway.service /etc/systemd/system/magi-gateway.service
sudo cp /home/pi/MAGI/pi-gateway/magi-gateway.env.example /etc/magi-gateway.env
sudo chown root:magigw /etc/magi-gateway.env
sudo chmod 640 /etc/magi-gateway.env
```

### 6-3. 설정 파일 채우기

```bash
sudo nano /etc/magi-gateway.env
```

두 줄을 채운다. (나머지는 그대로 둔다.)

```
FREELLMAPI_KEY=freellmapi-...(5-5에서 복사한 통합 키)
ALLOWED_USER_IDS=(내 Supabase 사용자 ID)
```

**내 Supabase 사용자 ID 찾기**: Supabase 대시보드(supabase.com) → MAGI가 쓰는 프로젝트 → **Authentication** → **Users** → 내 이메일 줄의 **UID**를 복사한다. (`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` 형태)

저장: `Ctrl + O` → `Enter`, 나가기: `Ctrl + X`

### 6-4. 서비스 켜기

1단계의 `which node`가 `/usr/bin/node`가 아니었다면 먼저 서비스 파일을 고친다.

```bash
sudo nano /etc/systemd/system/magi-gateway.service
```

`ExecStart=/usr/bin/node /opt/magi-gateway/gateway.mjs`의 `/usr/bin/node` 부분을 `which node` 결과로 바꾼다. (`/usr/bin/node`였다면 이 과정은 건너뛴다.)

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now magi-gateway
systemctl status magi-gateway --no-pager
```

`Active: active (running)`이 보이고, 로그에 `127.0.0.1:8787 에서 대기 중`이 나오면 성공이다.

### 6-5. 확인

```bash
curl -s http://127.0.0.1:8787/health
```

`{"ok":true}`가 나와야 한다.

```bash
sudo ss -ltnp | grep 8787
```

**`127.0.0.1:8787`**만 보여야 한다.

---

## 7단계. 문지기만 인터넷에 공개 (Funnel)

```bash
sudo tailscale funnel --bg 8787
```

- 처음이면 Funnel 사용을 허가하라는 링크가 나온다. 링크를 열어 허가하고, 같은 명령을 한 번 더 실행한다.

```bash
sudo tailscale funnel status
```

아래 두 가지가 보이면 맞다. (표시 모양은 Tailscale 버전에 따라 조금 다를 수 있다.)

- `https://magi-pi.<tailnet>.ts.net` 옆에 **Funnel on**, 그 아래에 `proxy http://127.0.0.1:8787`
- `https://magi-pi.<tailnet>.ts.net:8443` 옆에 **tailnet only**, 그 아래에 `proxy http://127.0.0.1:3001`

> **3001(FreeLLMAPI)은 절대 Funnel에 올리지 않는다.** Funnel에는 8787(문지기)만 올린다.

새 공개 주소는 퍼지는 데 최대 10분쯤 걸릴 수 있다.

---

## 8단계. 밖에서 확인 (휴대폰 데이터로)

휴대폰 와이파이를 끄고, **휴대폰의 Tailscale 앱도 끈 상태**에서 브라우저로 열어 본다.

| 주소 | 정상 결과 |
|---|---|
| `https://magi-pi.<tailnet>.ts.net/health` | `{"ok":true}` |
| `https://magi-pi.<tailnet>.ts.net/` | `없는 주소입니다` (관리 화면이 보이면 안 된다) |
| `https://magi-pi.<tailnet>.ts.net/v1/models` | 로그인이 필요하다는 메시지 |
| `https://magi-pi.<tailnet>.ts.net:8443` | 열리지 않아야 정상 (내 기기 전용) |

---

## 9단계. MAGI에 연결 (파이 밖, 참고)

MAGI → 설정 → **개인 서버** 탭 → 주소 칸에 `https://magi-pi.<tailnet>.ts.net` → **키 확인**.
`✓ 개인 서버 연결이 확인되었습니다`가 나오면 끝이다.

---

## 자주 쓰는 명령

| 하고 싶은 것 | 명령 |
|---|---|
| 문지기 로그 실시간 보기 | `journalctl -u magi-gateway -f` |
| 문지기 다시 시작 (설정 바꾼 뒤) | `sudo systemctl restart magi-gateway` |
| 문지기 설정 고치기 | `sudo nano /etc/magi-gateway.env` |
| FreeLLMAPI 상태 | `cd /home/pi/freellmapi && docker compose ps` |
| FreeLLMAPI 로그 | `cd /home/pi/freellmapi && docker compose logs --tail 100 freellmapi` |
| FreeLLMAPI 다시 시작 | `cd /home/pi/freellmapi && docker compose restart` |
| 공개·비공개 연결 상태 | `sudo tailscale funnel status` |
| 공개 끄기 (문지기) | `sudo tailscale funnel --https=443 off` |
| 관리 화면 연결 끄기 | `sudo tailscale serve --https=8443 off` |
| 파이 온도 | `vcgencmd measure_temp` |

## 원격 종료 (MAGI의 '개인 서버 끄기' 버튼)

MAGI 설정 → 개인 서버 탭의 **개인 서버 끄기** 버튼으로 파이를 안전하게 끌 수 있다.
문지기는 권한이 없어서 `/run/magi-gateway/poweroff` 파일만 만들고, root 권한의 `magi-poweroff.path`가 그 파일을 보고 파이를 끈다.
버튼도 채팅과 똑같이 로그인 + 허용 계정(ALLOWED_USER_IDS) 확인을 통과해야만 작동한다.

설치 (한 번만):

```bash
cd /home/pi/MAGI && git pull
sudo cp /home/pi/MAGI/pi-gateway/gateway.mjs /opt/magi-gateway/gateway.mjs
sudo cp /home/pi/MAGI/pi-gateway/magi-gateway.service /etc/systemd/system/magi-gateway.service
sudo sed -i "s|/usr/bin/node|$(which node)|" /etc/systemd/system/magi-gateway.service
sudo cp /home/pi/MAGI/pi-gateway/magi-poweroff.path /etc/systemd/system/magi-poweroff.path
sudo cp /home/pi/MAGI/pi-gateway/magi-poweroff.service /etc/systemd/system/magi-poweroff.service
sudo systemctl daemon-reload
sudo systemctl enable --now magi-poweroff.path
sudo systemctl restart magi-gateway
```

## 원격 재시작 (MAGI의 '재시작' 버튼)

끄기와 같은 방식이다. 문지기는 `/run/magi-gateway/reboot` 파일만 만들고, root 권한의 `magi-reboot.path`가 그 파일을 보고 파이를 재시작한다. 로그인 + 허용 계정 확인을 통과해야만 작동한다.
설치는 아래 '업데이트'의 `update.sh`가 함께 해 준다.

## 보안 업데이트 자동 설치 (한 번만)

```bash
sudo bash ~/MAGI/pi-gateway/setup-auto-update.sh
```

Debian 표준 도구(unattended-upgrades)로 **보안 업데이트만** 매일 자동 설치한다. 자동 재시작은 하지 않는다.
그 밖의 업데이트(라즈베리파이 커널·펌웨어 포함)는 `update.sh`가 설치하는 **월간 업데이트 예약**(`magi-monthly-update.timer`)이 매월 1일 17:00(한국 시간)에 전체 업데이트를 하고, FreeLLMAPI(Docker)도 최신으로 바꾼 뒤 재시작한다. 국내·미국 주식시장이 모두 닫힌 시간이다. 그 시각에 파이가 꺼져 있으면 그달은 건너뛴다. 기록: `/var/log/magi-monthly-update.log`, 다음 예정 시각: `systemctl list-timers magi-monthly-update.timer`.
Docker 안의 FreeLLMAPI는 매일 자동 업데이트에는 포함되지 않고, 아래 월간 업데이트 때 함께 바뀐다.

## 업데이트

문지기만 바꿀 때는 이 두 줄이면 된다 (원격 끄기·재시작 장치도 함께 설치·갱신된다):

```bash
cd ~/MAGI && git pull
sudo bash pi-gateway/update.sh
```

아래는 같은 일을 손으로 하는 방법이다.

FreeLLMAPI:

```bash
cd /home/pi/freellmapi
git pull
docker compose pull
docker compose up -d
```

문지기:

```bash
cd /home/pi/MAGI
git pull
sudo cp /home/pi/MAGI/pi-gateway/gateway.mjs /opt/magi-gateway/gateway.mjs
sudo systemctl restart magi-gateway
```

MAGI 설정 화면의 "상태 확인"(CPU 온도 등)은 문지기의 `GET /admin/status`를 씁니다. 버튼을 눌렀을 때 "문지기를 업데이트하세요"가 나오면 위 세 줄을 실행하면 됩니다.

## 백업 (SD 카드 고장 대비)

```bash
mkdir -p /home/pi/backup
cp /home/pi/freellmapi/.env /home/pi/backup/freellmapi.env
sudo cp /etc/magi-gateway.env /home/pi/backup/magi-gateway.env
cd /home/pi/freellmapi
docker compose stop
docker run --rm -v freellmapi_freellmapi-data:/data -v /home/pi/backup:/backup alpine tar czf /backup/freellmapi-data.tgz -C /data .
docker compose start
sudo chown pi:pi /home/pi/backup/*
chmod 600 /home/pi/backup/*
```

`/home/pi/backup` 폴더의 세 파일을 PC로 옮겨 둔다. 이 파일에는 키가 들어 있으니 GitHub 같은 곳에 올리지 않는다.

## 문제 해결

| MAGI에 나오는 메시지 | 확인할 것 |
|---|---|
| `개인 서버는 MAGI에 로그인해야 쓸 수 있습니다` | MAGI에서 로그인 |
| `이 개인 서버를 쓸 수 있는 계정이 아닙니다` | `/etc/magi-gateway.env`의 `ALLOWED_USER_IDS`. `journalctl -u magi-gateway -n 20`에 찍힌 `id=...`와 같은지 비교 → 고친 뒤 `sudo systemctl restart magi-gateway` |
| `허용되지 않은 사이트에서 온 요청입니다` | `/etc/magi-gateway.env`의 `ALLOWED_ORIGINS=https://butter3662.github.io` (끝에 `/` 없음) |
| `FreeLLMAPI에 연결하지 못했습니다` | `cd /home/pi/freellmapi && docker compose ps` → 꺼져 있으면 `docker compose up -d` |
| `네트워크 오류` | 파이 전원·인터넷, `sudo tailscale funnel status` |
| `요청 한도를 초과했습니다` | 관리 화면(8443)에서 회사 키 상태 확인, 또는 `RATE_PER_MIN` 값 |

## 알아 둘 점

- FreeLLMAPI는 개인 실험용이다. 각 회사 무료 티어 약관이 그대로 적용되고, 한도와 모델은 예고 없이 바뀐다.
- Tailscale Funnel은 베타 기능이고, Funnel로 오가는 트래픽에는 조절할 수 없는 대역폭 제한이 있다.
- 무료 모델로 보낸 질문과 첨부 파일은 그 모델을 제공하는 회사로 전달된다. 민감한 내용은 넣지 않는다.
