<?php
// Copy this file to sites.php (same folder as bouncer.php) and fill it in.
// If someone requests sites.php in a browser it just runs and prints nothing,
// so unlike sites.json it cannot be downloaded. Keep it out of git.
return [
    'anna@bakery.com' => [
        'password'     => 'a-long-random-password-of-at-least-12-characters',
        // or a hash made with: php -r 'echo password_hash("the-password", PASSWORD_DEFAULT);'
        'github_token' => 'github_pat_...',   // fine-grained token, Contents: read & write, ONE repo
        'github_owner' => 'your-github-user',
        'github_repo'  => 'bakery-site',
    ],
];
