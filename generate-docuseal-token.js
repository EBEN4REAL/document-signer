import jwt from "jsonwebtoken"

const DOCUSEAL_API_KEY = 'i6erz7EjoraFGLwW3eJj6Y2HcssKPG5yqTANK4AeNrD';

const payload = {
  user_email: 'igbinobaebenezer@gmail.com',
  document_urls: ['https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf'],
  name: 'ACP Consent Form Template',
  folder_name: 'HH Consent Templates'
};

export const token = jwt.sign(payload, DOCUSEAL_API_KEY, {
  algorithm: 'HS256',
  // expiresIn: '10m'
});

console.log('Your Docuseal JWT:\n');
console.log(token);
