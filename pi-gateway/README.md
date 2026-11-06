# MAGI × 라즈베리파이 무료 LLM 서버 설치 안내

라즈베리파이 4에 FreeLLMAPI(여러 회사의 무료 AI 한도를 묶어 주는 중계기)를 올리고, MAGI에서 'Pi 서버' 공급자로 쓰는 방법이다.
목표는 **어떤 키도 파이 밖으로 나가지 않게** 하는 것이다.

## 구조

```
MAGI(브라우저, GitHub Pages)
   │  Supabase 로그인 토큰만 보냄 (AI 키 없음)
   ▼
Tailscale Funnel  https://<파이이름>.<tailnet>.ts.net  (HTTPS, 공유기 포트 개방 없음)
   ▼
문지기 pi-gateway  127.0.0.1:8787
   │  1) 로그인 토큰을 Supabase에 확인 → 허용 목록(ALLOWED_USER_IDS)에 있는 계정만 통과
   │  2) 허용 사이트(butter3662.github.io)에서 온 요청만 통과
   │  3) 채팅·모델 목록 주소만 통과, 나머지(관리 화면 포함)는 404
   │  4) FreeLLMAPI 통합 키를 여기서 붙임
   ▼
FreeLLMAPI  127.0.0.1:3001  (Docker, 파이 내부 전용)
   │  각 회사 API 키는 FreeLLMAPI 안에 암호화되어 저장됨
   ▼
Google, Groq, Mistral, NVIDIA ...
```

| 키 | 있는 곳 | 인터넷에서 보이는가 |
|---|---|---|
| 각 회사 API 키 | FreeLLMAPI 데이터베이스 (파이) | 아니다 |
| FreeLLMAPI 통합 키 | `/etc/magi-gateway.env` (파이) | 아니다 |
| FreeLLMAPI 관리 화면 | 127.0.0.1:3001 (파이) | 아니다 (SSH 터널로만 접속) |
| Supabase 공개(publishable) 키 | MAGI 코드, 문지기 설정 | 원래 공개용이라 상관없다 |

## 0. 준비

- 라즈베리파이 OS Lite (64-bit)를 설치하고 SSH로 접속할 수 있는 상태
- MAGI에 가입·로그인된 내 계정
- Tailscale 계정 (무료 Personal 플랜이면 된다)

아래 명령은 모두 파이에 SSH로 접속해서 실행한다.

```bash
sudo apt update && sudo apt full-upgrade -y
sudo apt install -y git openssl nodejs
node -v   # v18 이상이면 된다
```

## 1. Docker 설치

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# 그룹 적용을 위해 SSH를 한 번 끊었다가 다시 접속한다
docker run --rm hello-world   # 동작 확인
```

## 2. FreeLLMAPI 설치 (파이 내부 전용)

```bash
git clone --depth 1 https://github.com/tashfeenahmed/freellmapi.git ~/freellmapi
cd ~/freellmapi
printf "ENCRYPTION_KEY=%s\nPORT=3001\n" "$(openssl rand -hex 32)" > .env
chmod 600 .env
docker compose pull
docker compose up -d
docker compose ps        # freellmapi가 running이면 성공
```

- 이 설정은 기본적으로 `127.0.0.1:3001`에만 열린다. **`HOST_BIND=0.0.0.0`은 절대 넣지 않는다.** 넣으면 관리 화면이 집 네트워크 전체에 열린다.
- `.env`의 `ENCRYPTION_KEY`는 저장된 회사 키를 암호화하는 열쇠다. 잃어버리면 저장된 키를 못 푼다. 따로 안전한 곳에 적어 둔다.

### 관리 화면 열기 (PC에서 SSH 터널)

관리 화면은 인터넷에 열지 않으므로, PC에서 SSH 터널로 접속한다.

```bash
# PC 터미널에서 (pi와 raspberrypi.local은 내 사용자 이름·호스트 이름으로 바꾼다)
ssh -L 3001:127.0.0.1:3001 pi@raspberrypi.local
```

터널을 켜 둔 상태에서 PC 브라우저로 `http://localhost:3001`을 연다.

1. 첫 계정(이메일·비밀번호)을 만든다. 설치 코드를 물으면 파이에서 `cd ~/freellmapi && docker compose logs freellmapi | tail -50`으로 로그에 찍힌 코드를 확인한다.
2. **Keys** 페이지에서 쓸 회사의 API 키를 넣는다. Google AI Studio, Groq, Mistral, NVIDIA, Cloudflare처럼 공식 회사 키부터 넣는 것을 권한다.
3. **Keys** 페이지 위쪽의 **통합 키**(freellmapi-로 시작)를 복사해 둔다. 3단계에서 쓴다.

## 3. 문지기(pi-gateway) 설치

```bash
git clone --depth 1 https://github.com/butter3662/MAGI.git ~/MAGI

# 문지기 전용 사용자 (로그인 불가)
sudo useradd --system --no-create-home --shell /usr/sbin/nologin magigw

sudo mkdir -p /opt/magi-gateway
sudo cp ~/MAGI/pi-gateway/gateway.mjs /opt/magi-gateway/
sudo cp ~/MAGI/pi-gateway/magi-gateway.service /etc/systemd/system/
sudo cp ~/MAGI/pi-gateway/magi-gateway.env.example /etc/magi-gateway.env
sudo chown root:magigw /etc/magi-gateway.env
sudo chmod 640 /etc/magi-gateway.env
sudo nano /etc/magi-gateway.env
```

`/etc/magi-gateway.env`에서 두 값을 채운다.

- `FREELLMAPI_KEY=` 뒤에 2단계에서 복사한 통합 키
- `ALLOWED_USER_IDS=` 뒤에 내 Supabase 사용자 ID
  - Supabase 대시보드 → Authentication → Users에서 내 계정의 UID를 복사한다.
  - 찾기 어려우면 비워 둔 채 5단계까지 진행한다. MAGI에서 '키 확인'을 누르면 거절되면서 로그에 `거절: ... id=...`가 찍히니, 그 id를 넣으면 된다.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now magi-gateway
sudo systemctl status magi-gateway --no-pager
curl http://127.0.0.1:8787/health      # {"ok":true} 이면 성공
```

로그 보기: `journalctl -u magi-gateway -f`
설정을 바꾼 뒤에는: `sudo systemctl restart magi-gateway`

## 4. Tailscale Funnel로 문지기만 공개

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up            # 나오는 링크를 열어 내 Tailscale 계정에 파이를 등록
sudo tailscale funnel --bg 8787
```

- 처음 실행하면 MagicDNS, HTTPS 인증서, Funnel 사용 허가를 묻는 링크가 나온다. 링크를 열어 모두 허용한다.
- `--bg`로 켜 두면 재부팅 뒤에도 자동으로 다시 켜진다.
- `tailscale funnel status`로 공개 주소(`https://<파이이름>.<tailnet>.ts.net`)를 확인한다. 새 주소는 퍼지는 데 최대 10분쯤 걸릴 수 있다.
- **8787(문지기)만 공개한다. 3001(FreeLLMAPI)은 절대 Funnel에 올리지 않는다.**
- 끌 때: `sudo tailscale funnel reset`

### 공개 확인 (휴대폰 데이터로 접속해 보면 확실하다)

| 주소 | 정상 결과 |
|---|---|
| `https://<주소>/health` | `{"ok":true}` |
| `https://<주소>/` | `없는 주소입니다` (404). 관리 화면이 안 보여야 정상 |
| `https://<주소>/v1/models` | 로그인 필요 (401) |

## 5. MAGI에 연결

1. MAGI에 로그인한다. (Pi 서버는 로그인해야만 쓸 수 있다.)
2. 설정 → AI 제공사에서 **Pi 서버** 탭을 누른다.
3. 주소 칸에 `https://<파이이름>.<tailnet>.ts.net`을 넣고 **키 확인**을 누른다.
   `✓ Pi 서버 연결이 확인되었습니다 · 지금 쓸 수 있는 모델 N개`가 나오면 성공이다.
4. **목록**을 누르면 FreeLLMAPI에서 지금 쓸 수 있는 모델이 불러와진다.
   - `auto:smart`: 지능 우선으로 자동 선택 (기본값)
   - `auto:fast`: 속도 우선
   - 모델 ID를 직접 고르면 그 모델로 고정된다.
5. 노드마다 다른 공급자를 쓰려면 '노드별로 다른 AI 사용 (고급)'을 켜고, 노드별로 Pi 서버와 다른 공급자를 섞어 쓸 수 있다.

## 문제 해결

| 증상 | 원인과 해결 |
|---|---|
| `Pi 서버는 MAGI에 로그인해야 쓸 수 있습니다` | MAGI에서 로그인한다 |
| `이 파이 서버를 쓸 수 있는 계정이 아닙니다` | `ALLOWED_USER_IDS`에 내 UID를 넣고 `sudo systemctl restart magi-gateway` |
| `허용되지 않은 사이트에서 온 요청입니다` | `ALLOWED_ORIGINS`가 `https://butter3662.github.io`인지 확인 (끝에 / 없음) |
| `FreeLLMAPI에 연결하지 못했습니다` | `cd ~/freellmapi && docker compose ps`로 켜져 있는지 확인, 꺼졌으면 `docker compose up -d` |
| `네트워크 오류` | 파이 전원·인터넷, `tailscale funnel status` 확인 |
| `요청 한도를 초과했습니다` | 무료 한도 소진 또는 `RATE_PER_MIN` 초과. FreeLLMAPI 관리 화면에서 키 상태 확인 |

## 업데이트

```bash
# FreeLLMAPI
cd ~/freellmapi && git pull && docker compose pull && docker compose up -d

# 문지기
cd ~/MAGI && git pull
sudo cp pi-gateway/gateway.mjs /opt/magi-gateway/ && sudo systemctl restart magi-gateway
```

## 알아 둘 점

- FreeLLMAPI는 개인 실험용이다. 각 회사 무료 티어 약관이 그대로 적용되고, 한도와 제공 모델은 예고 없이 바뀐다.
- Tailscale Funnel은 베타 기능이고, Funnel로 오가는 트래픽에는 조절할 수 없는 대역폭 제한이 있다.
- 무료 모델로 가는 질문과 첨부 파일은 그 모델을 제공하는 회사로 전달된다. 민감한 내용은 넣지 않는다.
