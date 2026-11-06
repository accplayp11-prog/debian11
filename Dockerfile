# =============================================================================
# Debian 11 (Bullseye) Terminal Image for Vercel Sandbox
# =============================================================================
# Image: debian-11-terminal:latest
# Platform: linux/amd64
#
# IMPORTANT:
# Vercel Sandbox does NOT execute ENTRYPOINT or CMD.
# All processes are started via sandbox.runCommand() after creation.
# =============================================================================

FROM debian:bullseye-slim

LABEL maintainer="debian-web-terminal"
LABEL description="Debian 11 Bullseye terminal for Vercel Sandbox"

ENV DEBIAN_FRONTEND=noninteractive
ENV TERM=xterm-256color
ENV LANG=en_US.UTF-8
ENV LC_ALL=en_US.UTF-8
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# =============================================================================
# Debian 11 archived repositories
# =============================================================================

RUN printf '%s\n' \
    'deb http://archive.debian.org/debian bullseye main contrib non-free' \
    'deb http://archive.debian.org/debian-security bullseye-security main contrib non-free' \
    'deb http://archive.debian.org/debian bullseye-updates main contrib non-free' \
    > /etc/apt/sources.list

# =============================================================================
# System packages
# =============================================================================

RUN apt-get update \
      --allow-releaseinfo-change \
      -o Acquire::Check-Valid-Until=false \
      -y \
    && apt-get install -y --no-install-recommends \
      bash \
      coreutils \
      util-linux \
      procps \
      psmisc \
      nano \
      vim \
      less \
      curl \
      wget \
      iputils-ping \
      iproute2 \
      net-tools \
      dnsutils \
      openssh-client \
      file \
      findutils \
      diffutils \
      tar \
      gzip \
      zip \
      unzip \
      build-essential \
      git \
      python3 \
      python3-pip \
      python3-venv \
      python3-dev \
      sudo \
      htop \
      tree \
      jq \
      locales \
      ca-certificates \
      gnupg \
      lsb-release \
    && rm -rf /var/lib/apt/lists/*

# =============================================================================
# Locale
# =============================================================================

RUN sed -i 's/^# en_US.UTF-8 UTF-8/en_US.UTF-8 UTF-8/' /etc/locale.gen \
    && locale-gen en_US.UTF-8

# =============================================================================
# Hostname
# IMPORTANT: Do not modify /etc/hosts during Docker build.
# Docker/Vercel manages this file at runtime.
# =============================================================================

RUN echo "debian" > /etc/hostname

# =============================================================================
# Install ttyd 1.7.7 (linux/amd64)
# =============================================================================

RUN curl -fsSL --retry 5 \
    "https://github.com/tsl0922/ttyd/releases/download/1.7.7/ttyd.x86_64" \
    -o /usr/local/bin/ttyd \
    && chmod 0755 /usr/local/bin/ttyd \
    && ttyd --version

# =============================================================================
# Root shell environment
# =============================================================================

RUN mkdir -p /root \
    && printf '%s\n' \
      'export PS1="\[\033[01;31m\]\u@\h\[\033[00m\]:\[\033[01;34m\]\w\[\033[00m\]\$ "' \
      'alias ll="ls -alF"' \
      'alias la="ls -A"' \
      'alias l="ls -CF"' \
      'export PYTHONDONTWRITEBYTECODE=1' \
      'export PYTHONUNBUFFERED=1' \
      >> /root/.bashrc

# =============================================================================
# Python packages
# =============================================================================

RUN pip3 install --no-cache-dir --upgrade pip \
    && pip3 install --no-cache-dir \
      requests \
      httpx \
      rich \
      click

# =============================================================================
# Workspace
# =============================================================================

RUN mkdir -p /workspace \
    && printf '%s\n' \
      'Welcome to Debian Web Terminal' \
      'Debian GNU/Linux 11 (Bullseye)' \
      'Running as root' \
      > /workspace/README.txt

# =============================================================================
# Verification
# =============================================================================

RUN grep -q 'VERSION_ID="11"' /etc/os-release \
    && grep -q '^ID=debian$' /etc/os-release \
    && echo "Verified: Debian GNU/Linux 11 (Bullseye)"

RUN command -v ttyd \
    && ttyd --version \
    && python3 --version \
    && pip3 --version \
    && echo "ttyd and Python are ready"

# =============================================================================
# Final configuration
# =============================================================================

WORKDIR /root

# Vercel Sandbox starts processes through sandbox.runCommand().
# No ENTRYPOINT or CMD required.
