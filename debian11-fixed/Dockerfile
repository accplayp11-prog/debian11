# =============================================================================
# Debian 11 (Bullseye) Terminal Image for Vercel Sandbox
# =============================================================================
# Build & push with:
#   vercel vcr build docker . debian-11-terminal:latest --push
# (run from project root with vercel link already done)
#
# IMPORTANT: Vercel Sandbox does NOT execute ENTRYPOINT or CMD.
# All processes are started via sandbox.runCommand() after creation.
# =============================================================================

FROM debian:bullseye-slim

LABEL maintainer="debian-web-terminal"
LABEL description="Debian 11 Bullseye terminal for Vercel Sandbox"

ENV DEBIAN_FRONTEND=noninteractive
ENV TERM=xterm-256color
ENV LANG=en_US.UTF-8
ENV LC_ALL=en_US.UTF-8

# ---------------------------------------------------------------------------
# Debian 11 is now ARCHIVED — use archive.debian.org
# ---------------------------------------------------------------------------
RUN printf 'deb http://archive.debian.org/debian bullseye main contrib non-free\n\
deb http://archive.debian.org/debian-security bullseye-security main contrib non-free\n\
deb http://archive.debian.org/debian bullseye-updates main contrib non-free\n' \
    > /etc/apt/sources.list

RUN apt-get update \
      --allow-releaseinfo-change \
      -o Acquire::Check-Valid-Until=false \
      -y

# ---------------------------------------------------------------------------
# System packages
# ---------------------------------------------------------------------------
RUN apt-get install -y --no-install-recommends \
    bash coreutils util-linux procps psmisc \
    nano vim less \
    curl wget iputils-ping iproute2 net-tools dnsutils openssh-client \
    file findutils diffutils tar gzip zip unzip \
    build-essential git \
    python3 python3-pip python3-venv python3-dev \
    sudo htop tree jq watch \
    locales ca-certificates gnupg lsb-release \
    # iproute2 includes ss (socket statistics) needed to verify ttyd binding
    && rm -rf /var/lib/apt/lists/*

# ---------------------------------------------------------------------------
# Locale
# ---------------------------------------------------------------------------
RUN sed -i 's/# en_US.UTF-8 UTF-8/en_US.UTF-8 UTF-8/' /etc/locale.gen \
    && locale-gen en_US.UTF-8

# ---------------------------------------------------------------------------
# Install ttyd DIRECTLY in the image — avoids runtime download dependency
# ttyd 1.7.7 for linux/amd64 (the only architecture VCR Sandbox uses)
# ---------------------------------------------------------------------------
RUN curl -fsSL --retry 5 \
    "https://github.com/tsl0922/ttyd/releases/download/1.7.7/ttyd.x86_64" \
    -o /usr/local/bin/ttyd \
    && chmod +x /usr/local/bin/ttyd \
    && ttyd --version

# ---------------------------------------------------------------------------
# Hostname / hosts
# ---------------------------------------------------------------------------
RUN echo "debian" > /etc/hostname \
    && printf '127.0.0.1\tlocalhost\tdebian\n' >> /etc/hosts

# ---------------------------------------------------------------------------
# Root shell environment
# ---------------------------------------------------------------------------
RUN mkdir -p /root && \
    printf 'export PS1="\\[\\033[01;31m\\]\\u@\\h\\[\\033[00m\\]:\\[\\033[01;34m\\]\\w\\[\\033[00m\\]\\$ "\n' >> /root/.bashrc && \
    printf 'alias ll="ls -alF"\nalias la="ls -A"\nalias l="ls -CF"\n' >> /root/.bashrc && \
    printf 'export PYTHONDONTWRITEBYTECODE=1\nexport PYTHONUNBUFFERED=1\n' >> /root/.bashrc

# ---------------------------------------------------------------------------
# Python packages
# ---------------------------------------------------------------------------
RUN pip3 install --no-cache-dir --upgrade pip \
    && pip3 install --no-cache-dir requests httpx rich click

# ---------------------------------------------------------------------------
# Workspace
# ---------------------------------------------------------------------------
RUN mkdir -p /workspace && \
    printf 'Welcome to Debian Web Terminal\nDebian GNU/Linux 11 (Bullseye)\nRunning as root\n' \
    > /workspace/README.txt

# ---------------------------------------------------------------------------
# Verify: this image MUST report Debian GNU/Linux 11
# ---------------------------------------------------------------------------
RUN grep -q 'VERSION_ID="11"' /etc/os-release \
    && grep -q 'ID=debian' /etc/os-release \
    && echo "✓ Verified: Debian GNU/Linux 11 (Bullseye)"

# ---------------------------------------------------------------------------
# Verify ttyd is on PATH (confirms the install above succeeded)
# ---------------------------------------------------------------------------
RUN which ttyd && ttyd --version && echo "✓ ttyd ready"

WORKDIR /root

# NOTE: Vercel Sandbox ignores ENTRYPOINT and CMD.
# ttyd is started at runtime via sandbox.runCommand() in sandbox.ts.
