# Extensão do VSCode para Oberon.

## Autores:

- Matheus Santos Alves - 180025163
- Richard Junio Lima Viana - 180077902

## Execução

Para executar o código, basta abrir o projeto no Visual Studio Code e pressionar `F5` ou `Ctrl + F5` para executar debug. Alternativamente, você pode executar o comando `Debug: Start Debugging` no menu `Run and Debug`. Para a utilização da extensão, é necessário ter instalado o openjdk na versão "17.0.7" .

## Criação de uma nova extensão para o VSCode

Para criar uma nova extensão, é necessário ter o [Node.js](https://nodejs.org/en/) instalado. Após isso, é necessário instalar o [Yeoman](https://yeoman.io/) e o [VSCode Extension Generator](https://www.npmjs.com/package/generator-code). Para isso, basta executar o comando

`
npm install -g yo generator-code` no terminal do VSCode.
`

basta executar o comando `yo code` no terminal do VSCode. Isso irá abrir um assistente para a criação de uma nova extensão. Para mais informações, acesse a [documentação](https://code.visualstudio.com/api/get-started/your-first-extension).

Selecionado o tipo de extensão, é necessário instalar as dependências do projeto. Para isso, basta executar o comando `npm install` no terminal, e para executar a extensão, basta abrir o projeto no VSCode e pressionar `F5` ou `Ctrl + F5` para executar debug. Alternativamente, você pode executar o comando `Debug: Start Debugging` no menu `Run and Debug`.

## Criação de um debug adapter

Para iniciar o desenvolvimento de um debug adapter sem iniciar um projeto de extensão e desenvolver todas as funcionalidades do zero, é necessário clonar o repositório [vscode-mock-debug](https://github.com/microsoft/vscode-mock-debug). Para isso, basta executar o comando

`git clone https://github.com/microsoft/vscode-mock-debug.git`

Após isso, é necessário instalar as dependências do projeto. Para isso, basta navegar ao diretório do projeto e executar o comando `npm install` no terminal, e para executar o debug adapter, basta abrir o projeto no VSCode e pressionar `F5` ou `Ctrl + F5` para executar debug. Alternativamente, você pode executar o comando `Debug: Start Debugging` no menu `Run and Debug`. Para mais informações acerca do desenvolvimento de um debug adapter, acesse a [documentação](https://code.visualstudio.com/api/extension-guides/debugger-extension).
