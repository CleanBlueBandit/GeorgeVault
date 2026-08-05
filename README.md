---

# How it Works

GeorgeVault is designed around one simple principle:

> **Your passwords never leave your computer.**

Unlike cloud-based password managers, every credential is stored locally using Chrome's storage API and is encrypted before being written to disk.

## Encryption

When you first launch the extension, you're asked to create a **master password**.

The master password itself is **never stored**.

Instead, the extension:

1. Generates a random 16-byte salt.
2. Uses **PBKDF2 (SHA-256)** with **250,000 iterations** to derive an encryption key.
3. Uses the derived key to encrypt the vault with **AES-256-GCM**.
4. Stores only:

   * the encrypted vault,
   * the initialization vector (IV),
   * and the random salt.

Without the correct master password, the stored data is computationally infeasible to decrypt.

## Unlocking

When unlocking the vault:

1. The stored salt is loaded.
2. The encryption key is derived again from your master password.
3. The vault is decrypted in memory.
4. If authentication fails, the extension simply reports that the password is incorrect.

The encryption key exists **only in memory** while the vault is unlocked and is discarded immediately when the vault is locked.

## Credential Storage

Each saved credential contains:

* Website
* Username / Email
* Password

Before being saved, the entire vault is encrypted as a single AES-GCM ciphertext.

This means there are **no plaintext credentials** stored anywhere inside Chrome's storage.

## Smart Site Detection

Whenever the extension opens, it automatically detects the currently active browser tab.

Matching credentials for the current website are displayed first, making them immediately accessible.

Subdomains are also supported, allowing credentials to work across sites such as:

* `github.com`
* `www.github.com`
* `docs.github.com`

## Autofill

The extension can automatically populate login forms using the Chrome Extension API.

Rather than simply assigning values to input fields, it dispatches the same events that websites expect from real user input, making it compatible with many modern web applications.

## Security Features

* AES-256-GCM authenticated encryption
* PBKDF2 key derivation (250,000 iterations)
* Random cryptographic salt
* Random IV for every encryption
* Master password never stored
* Encryption key never persisted
* Local-only credential storage
* HTML escaping to prevent XSS inside the extension

## Why I Built This

GeorgeVault started as a personal project to better understand modern browser cryptography and secure credential storage.

I think that cloud-based password managers defy their own purpose, they are meant to keep your passwords safe, so creating weak links, like cloud servers, dont make sence.

I Believe keeping this open source reassures the user that the extension does not sell client data the moment it gets its paws on internet connection.

Rather than relying on third-party encryption libraries, the project uses the browser's native **Web Crypto API**, allowing me to explore key derivation, authenticated encryption, browser storage, and extension APIs while building something practical.

These reasons are the most important in current times where megacorporations think they own your data and are allowed to invade your privacy because you use their service.
