# =============================================================================
# Debian 11 (Bullseye) Terminal Image for Vercel Sandbox
# =============================================================================
# This image is pushed to Vercel Container Registry (VCR) and used as the
# base image for the shared Vercel Sandbox.
#
# IMPORTANT: Vercel Sandbox does NOT execute ENTRYPOINT or CMD.
# Processes are started via sandbox.runCommand() after sandbox creation.
# =============================================================================

FROM debian:bullseye-slim

LABEL maintainer="debian-web-terminal"
LABEL description="Debian 11 Bullseye terminal environment for Vercel Sandbox"
LABEL version="1.0.0"

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive
ENV TERM=xterm-256color
ENV LANG=en_US.UTF-8
ENV LC_ALL=en_US.UTF-8

# =============================================================================
# Fix Debian 11 Bullseye archived repositories
# Debian 11 is now archived — use archive.debian.org mirrors
# =============================================================================
RUN printf 'deb http://archive.debian.org/debian bullseye main contrib non-free\n\
deb http://archive.debian.org/debian-security bullseye-security main contrib non-free\n\
deb http://archive.debian.org/debian bullseye-updates main contrib non-free\n' \
    > /etc/apt/sources.list

# Update package lists with archive fix
# --allow-releaseinfo-change handles expired metadata on archived repos
RUN apt-get update --allow-releaseinfo-change -y || \
    apt-get update --allow-releaseinfo-change -o Acquire::Check-Valid-Until=false -y

# =============================================================================
# Install essential system packages
# =============================================================================
RUN apt-get install -y --no-install-recommends \
    # Core utilities
    bash \
    coreutils \
    util-linux \
    procps \
    psmisc \
    # Text editors
    nano \
    vim \
    less \
    # Network tools
    curl \
    wget \
    iputils-ping \
    iproute2 \
    net-tools \
    dnsutils \
    openssh-client \
    # File management
    file \
    findutils \
    diffutils \
    tar \
    gzip \
    zip \
    unzip \
    # Development tools
    build-essential \
    git \
    # Python 3
    python3 \
    python3-pip \
    python3-venv \
    python3-dev \
    # System tools
    sudo \
    htop \
    tree \
    jq \
    watch \
    man-db \
    # Locale support
    locales \
    # Misc
    ca-certificates \
    gnupg \
    lsb-release \
    && rm -rf /var/lib/apt/lists/*

# =============================================================================
# Configure locale
# =============================================================================
RUN sed -i 's/# en_US.UTF-8 UTF-8/en_US.UTF-8 UTF-8/' /etc/locale.gen && \
    locale-gen en_US.UTF-8

# =============================================================================
# Configure hostname
# =============================================================================
RUN echo "debian" > /etc/hostname

# =============================================================================
# Configure /etc/hosts
# =============================================================================
RUN echo "127.0.0.1 localhost debian" >> /etc/hosts

# =============================================================================
# Create a working home directory for root
# =============================================================================
RUN mkdir -p /root && \
    echo 'export PS1="\[\033[01;31m\]\u@\h\[\033[00m\]:\[\033[01;34m\]\w\[\033[00m\]\$ "' >> /root/.bashrc && \
    echo 'alias ll="ls -alF"' >> /root/.bashrc && \
    echo 'alias la="ls -A"' >> /root/.bashrc && \
    echo 'alias l="ls -CF"' >> /root/.bashrc && \
    echo 'export PYTHONDONTWRITEBYTECODE=1' >> /root/.bashrc && \
    echo 'export PYTHONUNBUFFERED=1' >> /root/.bashrc

# =============================================================================
# Install pip3 packages
# =============================================================================
RUN pip3 install --no-cache-dir --upgrade pip && \
    pip3 install --no-cache-dir \
    requests \
    httpx \
    rich \
    click

# =============================================================================
# Create persistent workspace directory
# =============================================================================
RUN mkdir -p /workspace && \
    echo "Welcome to Debian Web Terminal" > /workspace/README.txt && \
    echo "Debian GNU/Linux 11 (Bullseye)" >> /workspace/README.txt && \
    echo "Running as root user" >> /workspace/README.txt

# =============================================================================
# Verify OS identity — this MUST report Debian 11
# =============================================================================
RUN cat /etc/os-release && \
    grep -q 'VERSION_ID="11"' /etc/os-release && \
    grep -q 'ID=debian' /etc/os-release && \
    echo "✓ Verified: Debian GNU/Linux 11 (Bullseye)"

# =============================================================================
# Working directory
# =============================================================================
WORKDIR /root

# NOTE: Vercel Sandbox does NOT run ENTRYPOINT or CMD.
# The root password is set at runtime via sandbox.runCommand() using
# the DEBIAN_ROOT_PASSWORD environment variable.
