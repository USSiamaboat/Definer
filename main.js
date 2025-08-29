// --- UTILITY MODULE ---
const Utils = (() => {
    function sanitizeHTML(str) {
        const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" }
        return str.replace(/[&<>"']/g, m => map[m])
    }
    function levenshteinDistance(a, b) {
        const matrix = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null))
        for (let i = 0; i <= a.length; i += 1) { matrix[0][i] = i }
        for (let j = 0; j <= b.length; j += 1) { matrix[j][0] = j }
        for (let j = 1; j <= b.length; j += 1) {
            for (let i = 1; i <= a.length; i += 1) {
                const indicator = a[i - 1] === b[j - 1] ? 0 : 1
                matrix[j][i] = Math.min(matrix[j][i - 1] + 1, matrix[j - 1][i] + 1, matrix[j - 1][i - 1] + indicator)
            }
        }
        return matrix[b.length][a.length]
    }
    return { sanitizeHTML, levenshteinDistance }
})()

// --- DATA MODULE ---
const Data = (() => {
    let definitions = []
    let commandHistory = []
    const STORAGE_KEY = "latex_definer_definitions"
    function loadDefinitions() {
        const storedDefs = localStorage.getItem(STORAGE_KEY)
        if (storedDefs) {
            try { definitions = JSON.parse(storedDefs) } 
            catch (error) { console.error("Error parsing definitions from localStorage:", error); loadDefaultDefinitions() }
        } else { loadDefaultDefinitions() }
    }
    function loadDefaultDefinitions() {
        const defaultDefsJSON = document.getElementById("definitionsData").textContent
        definitions = JSON.parse(defaultDefsJSON)
    }
    function persistDefinitions() { localStorage.setItem(STORAGE_KEY, JSON.stringify(definitions)) }
    
    function findMatches(term) {
        const searchTerm = term.toLowerCase()
        let exactMatch = null
        const partialMatches = []

        for (const def of definitions) {
            const termLower = def.term.toLowerCase()
            const aliasesLower = (def.aliases || []).map(a => a.toLowerCase())

            if (termLower === searchTerm || aliasesLower.includes(searchTerm)) {
                exactMatch = def
                break 
            }

            if (termLower.includes(searchTerm) || aliasesLower.some(a => a.includes(searchTerm))) {
                partialMatches.push(def)
            }
        }
        
        if (exactMatch) {
            return { exactMatch: exactMatch, partialMatches: [] }
        }

        return { exactMatch: null, partialMatches: partialMatches }
    }

    function getBestSuggestion(term) {
        let bestMatch = { term: null, distance: Infinity }
        const SUGGESTION_THRESHOLD = 3 
        definitions.forEach(def => {
            [def.term, ...(def.aliases || [])].forEach(key => {
                const dist = Utils.levenshteinDistance(term, key.toLowerCase())
                if (dist < bestMatch.distance) { bestMatch = { term: key, distance: dist } }
            })
        })
        return bestMatch.distance <= SUGGESTION_THRESHOLD ? bestMatch.term : null
    }
    return {
        load: loadDefinitions, persist: persistDefinitions,
        getDefinitions: () => definitions, 
        replaceAllDefinitions: (newDefs) => { definitions = newDefs },
        find: findMatches, getSuggestion: getBestSuggestion,
        addDefinition: (def) => definitions.push(def), 
        updateDefinition: (index, def) => definitions[index] = def,
        deleteDefinition: (index) => definitions.splice(index, 1),
        getCommandHistory: () => commandHistory,
        addToHistory: (cmd) => { if (commandHistory.length === 0 || commandHistory[commandHistory.length - 1] !== cmd) { commandHistory.push(cmd) } },
        clearHistory: () => commandHistory = [],
    }
})()

// --- UI MODULE ---
const UI = (() => {
    const output = document.getElementById("output")
    const commandInput = document.getElementById("commandInput")
    const editorModal = document.getElementById("editor-modal")
    const termInput = document.getElementById("term-input")
    const aliasesInput = document.getElementById("aliases-input")
    const tagsInput = document.getElementById("tags-input")
    const definitionInput = document.getElementById("definition-input")
    const previewOutput = document.getElementById("preview-output")
    const editorMessage = document.getElementById("editor-message")
    
    function renderBlock(htmlContent) {
        const block = document.createElement("div")
        block.innerHTML = htmlContent + "<br>" 
        output.appendChild(block)
        renderMathIn(block)
        window.scrollTo(0, document.body.scrollHeight)
    }
    
    function renderMathIn(element) {
         renderMathInElement(element, { delimiters: [{left: "$$", right: "$$", display: true}, {left: "$", right: "$", display: false}] })
    }

    function clearTerminal() { output.innerHTML = ""; showWelcomeMessage() }
    
    function showWelcomeMessage() { 
        renderBlock(`<p>LaTeX Definer v1.0  ---  © Jeffrey Lu 2025</p><p>Type 'help' to see available commands.</p>`)
    }

    function openEditor(defToEdit = null) {
        editorMessage.textContent = ""
        if (defToEdit) {
            termInput.value = defToEdit.term
            aliasesInput.value = (defToEdit.aliases || []).join(", ")
            tagsInput.value = (defToEdit.tags || []).join(", ")
            definitionInput.value = defToEdit.definition
        } else {
            termInput.value = ""
            aliasesInput.value = ""
            tagsInput.value = ""
            definitionInput.value = ""
        }
        previewOutput.innerHTML = ""
        updatePreview()
        editorModal.classList.remove("hidden")
        termInput.focus()
    }

    function closeEditor() { editorModal.classList.add("hidden"); commandInput.focus() }
    
    function updatePreview() {
        const sanitizedText = Utils.sanitizeHTML(definitionInput.value)
        previewOutput.innerHTML = `<p>${sanitizedText}</p>`
        renderMathIn(previewOutput)
    }

    return {
        renderBlock, clearTerminal, showWelcomeMessage, openEditor, closeEditor, updatePreview,
        getEditorValues: () => ({
            term: termInput.value.trim(),
            aliases: aliasesInput.value.split(",").map(a => a.trim()).filter(a => a),
            tags: tagsInput.value.split(",").map(t => t.trim()).filter(t => t),
            definition: definitionInput.value.trim(),
        }),
        setEditorMessage: (msg) => editorMessage.textContent = msg,
    }
})()

// --- COMMANDS MODULE ---
const Commands = (() => {
    let currentEditIndex = null
    const RESERVED_COMMANDS = ["help", "clear", "list", "ls", "add", "edit", "delete", "rm", "find", "import", "export"]
    let pendingImportData = null

    function findDefinitionAndIndex(searchTerm) {
        const termLower = searchTerm.toLowerCase()
        const defIndex = Data.getDefinitions().findIndex(d => 
            d.term.toLowerCase() === termLower || 
            (d.aliases && d.aliases.map(a => a.toLowerCase()).includes(termLower))
        )
        return (defIndex > -1) ? { definition: Data.getDefinitions()[defIndex], index: defIndex } : { definition: null, index: -1 }
    }

    function process(command) {
        const commandArgs = command.trim().split(" ")
        const baseCommand = commandArgs[0].toLowerCase()
        const searchTerm = commandArgs.slice(1).join(" ")
        let result = null

        let commandEchoHTML = `<div class="input-line"><span class="prompt-char">&gt;</span><p>${Utils.sanitizeHTML(command)}</p></div>`

        switch(baseCommand) {
            case "help": result = showHelp(); break
            case "clear": UI.clearTerminal(); Data.clearHistory(); return
            case "ls":
            case "list": result = listTerms(commandArgs[1]); break
            case "add": 
                currentEditIndex = null 
                UI.openEditor() 
                UI.renderBlock(commandEchoHTML)
                return
            case "edit":
                if (!searchTerm) { result = { html: "Usage: edit [term]", className: "text-yellow-400" } } 
                else {
                    const { definition, index } = findDefinitionAndIndex(searchTerm)
                    if (definition) {
                        currentEditIndex = index 
                        UI.openEditor(definition) 
                        UI.renderBlock(commandEchoHTML)
                        return
                    } 
                    else { result = { html: `Error: Term '${Utils.sanitizeHTML(searchTerm)}' not found.`, className: "text-red-400" } }
                }
                break
            case "rm":
            case "delete":
                result = deleteTerm(commandArgs)
                break
            case "find": result = findDefinition(searchTerm); break
            case "export":
                exportDefinitions()
                result = { html: "Exporting definitions...", className: "text-green-400" }
                break
            case "import":
                result = importDefinitions(commandArgs)
                break
            default: result = findDefinition(command)
        }
        
        let finalHTML = commandEchoHTML
        if (result && result.html) {
            const resultClass = result.className ? ` class="${result.className}"` : ""
            finalHTML += `<div${resultClass}><br>${result.html}</div>`
        }
        
        UI.renderBlock(finalHTML)
    }

    function saveDefinition() {
        const { term, aliases, tags, definition } = UI.getEditorValues()
        const termLower = term.toLowerCase()
        
        if (!term || !definition) { UI.setEditorMessage("Term and Definition are required."); return }
        if (RESERVED_COMMANDS.includes(termLower)) { UI.setEditorMessage(`Error: '${term}' is a reserved command.`); return }
        if (term.includes(",")) { UI.setEditorMessage(`Error: Term cannot contain commas.`); return }

        const aliasCollision = aliases.find(alias => RESERVED_COMMANDS.includes(alias.toLowerCase()))
        if (aliasCollision) { UI.setEditorMessage(`Error: Alias '${aliasCollision}' is a reserved command.`); return }
        
        const aliasSet = new Set(aliases.map(a => a.toLowerCase()))
        if (aliasSet.size !== aliases.length) { UI.setEditorMessage("Error: Duplicate aliases are not allowed."); return }
        if (aliasSet.has(termLower)) { UI.setEditorMessage("Error: Term cannot also be an alias."); return }

        const definitions = Data.getDefinitions()
        const allOtherTermsAndAliases = new Set()
        definitions.forEach((def, index) => {
            if (currentEditIndex !== null && index === currentEditIndex) return
            allOtherTermsAndAliases.add(def.term.toLowerCase())
            if (def.aliases) { def.aliases.forEach(alias => allOtherTermsAndAliases.add(alias.toLowerCase())) }
        })

        if (allOtherTermsAndAliases.has(termLower)) { UI.setEditorMessage(`Error: Term '${term}' already exists.`); return }
        for (const alias of aliases) {
            if (allOtherTermsAndAliases.has(alias.toLowerCase())) { UI.setEditorMessage(`Error: Alias '${alias}' already exists.`); return }
        }

        const termRegex = /^[a-z0-9\s-'.]+$/i 
        const tagRegex = /^[a-z0-9-]+$/i
        if (!termRegex.test(term)) { UI.setEditorMessage("Term contains invalid characters."); return }
        if (aliases.some(alias => !termRegex.test(alias))) { UI.setEditorMessage("Aliases contain invalid characters."); return }
        if (tags.some(tag => !tagRegex.test(tag))) { UI.setEditorMessage("Tags can only contain letters, numbers, and hyphens."); return }

        let message = ""
        let messageClass = ""

        if (currentEditIndex !== null) { // Edit mode
            Data.updateDefinition(currentEditIndex, { term, aliases, tags, definition })
            message = `Definition for '${Utils.sanitizeHTML(term)}' updated.`
            messageClass = "text-green-400"
        } else { // Add mode
            Data.addDefinition({ term, aliases, tags, definition })
            message = `Definition for '${Utils.sanitizeHTML(term)}' saved.`
            messageClass = "text-green-400"
        }
        
        Data.persist()
        UI.closeEditor()
        UI.renderBlock(`<div class="${messageClass}">${message}</div>`)
    }

    function deleteTerm(args) {
        const confirmFlag = "--confirm"
        const termToDelete = args.slice(1).filter(arg => arg !== confirmFlag).join(" ")

        if (!termToDelete) {
            return { html: "Usage: delete [term]", className: "text-yellow-400" }
        }

        const { definition, index } = findDefinitionAndIndex(termToDelete)

        if (!definition) {
            return { html: `Error: Term '${Utils.sanitizeHTML(termToDelete)}' not found.`, className: "text-red-400" }
        }

        if (!args.includes(confirmFlag)) {
            const confirmationMessage = `This is a destructive action. To confirm, type: <br><span class="font-bold">delete ${Utils.sanitizeHTML(termToDelete)} ${confirmFlag}</span>`
            return { html: confirmationMessage, className: "text-yellow-400" }
        }

        Data.deleteDefinition(index)
        Data.persist()
        return { html: `Definition for '${Utils.sanitizeHTML(definition.term)}' has been deleted.`, className: "text-green-400" }
    }

    function exportDefinitions() {
        const definitions = Data.getDefinitions()
        const jsonString = JSON.stringify(definitions, null, 2)
        const blob = new Blob([jsonString], { type: "application/json" })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = "definitions.json"
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
    }

    function importDefinitions(args) {
        if (args.includes("--confirm")) {
            if (pendingImportData) {
                Data.replaceAllDefinitions(pendingImportData)
                Data.persist()
                pendingImportData = null
                return { html: "Definitions successfully imported and saved.", className: "text-green-400" }
            } else {
                return { html: "No file loaded. Please run 'import' first.", className: "text-yellow-400" }
            }
        }

        const fileInput = document.createElement("input")
        fileInput.type = "file"
        fileInput.accept = ".json,application/json"
        fileInput.onchange = e => {
            const file = e.target.files[0]
            if (!file) return

            const reader = new FileReader()
            reader.onload = event => {
                try {
                    const data = JSON.parse(event.target.result)
                    if (!Array.isArray(data)) {
                        throw new Error("Invalid format: JSON must be an array.")
                    }
                    if (data.length > 0 && (!data[0].term || !data[0].definition)) {
                        throw new Error("Invalid format: Objects must contain 'term' and 'definition' keys.")
                    }
                    pendingImportData = data
                    const message = `File loaded successfully. Found ${data.length} definitions.<br>To replace current definitions, type: <span class="font-bold">import --confirm</span>`
                    UI.renderBlock(`<div class="text-yellow-400">${message}</div>`)
                } catch (error) {
                    const errorMessage = `Error reading file: ${error.message}`
                    UI.renderBlock(`<div class="text-red-400">${errorMessage}</div>`)
                    pendingImportData = null
                }
            }
            reader.readAsText(file)
        }
        fileInput.click()
        return { html: "Opening file dialog..." }
    }

    function formatDefinitionOutput(def) {
        let outputHTML = `<p><span class="font-bold text-green-400">Term:</span> ${Utils.sanitizeHTML(def.term)}</p>`
        
        const aliasesText = (def.aliases && def.aliases.length > 0)
            ? Utils.sanitizeHTML(def.aliases.join(", "))
            : "none"
        outputHTML += `<p><span class="font-bold text-green-400">Aliases:</span> ${aliasesText}</p>`

        const tagsText = (def.tags && def.tags.length > 0)
            ? Utils.sanitizeHTML(def.tags.join(", "))
            : "none"
        outputHTML += `<p><span class="font-bold text-green-400">Tags:</span> ${tagsText}</p>`
        
        outputHTML += `<br><p>${Utils.sanitizeHTML(def.definition)}</p>`
        return { html: outputHTML }
    }

    function findDefinition(term) {
        if (!term) { return { html: "Usage: find [term]", className: "text-yellow-400" } }
        
        const { exactMatch, partialMatches } = Data.find(term)

        if (exactMatch) {
            return formatDefinitionOutput(exactMatch)
        }

        if (partialMatches.length === 1) {
            return formatDefinitionOutput(partialMatches[0])
        }

        if (partialMatches.length > 1) {
            const possibleTerms = partialMatches.map(def => `- ${Utils.sanitizeHTML(def.term)}`).join("<br>")
            const message = `Ambiguous term. Did you mean one of these?<br>${possibleTerms}`
            return { html: message, className: "text-yellow-400" }
        }

        const suggestion = Data.getSuggestion(term.toLowerCase())
        const message = suggestion 
            ? `Error: Definition for '${Utils.sanitizeHTML(term)}' not found. Did you mean '${Utils.sanitizeHTML(suggestion)}'?`
            : `Error: Definition for '${Utils.sanitizeHTML(term)}' not found.`
        return { html: message, className: "text-red-400" }
    }

    function showHelp() {
        const helpText = `
<p><span class="font-bold">add</span>                 - Opens an editor to add a new definition.</p>
<p><span class="font-bold">edit [term]</span>         - Opens an editor to modify an existing definition.</p>
<p><span class="font-bold">delete, rm</span>          - Deletes a term after confirmation.</p>
<p><span class="font-bold">find [term]</span>         - Displays the definition for a term.</p>
<p><span class="font-bold">list, ls</span>            - Lists all terms, or only terms with a specific [tag].</p>
<p><span class="font-bold">import</span>              - Imports definitions from a JSON file.</p>
<p><span class="font-bold">export</span>              - Exports all definitions to a JSON file.</p>
<p><span class="font-bold">clear</span>               - Clears the terminal screen and command history.</p>
<p><span class="font-bold">help</span>                - Shows this help message.</p>
`
        return { html: helpText }
    }

    function listTerms(tag = null) {
        let termsToList = Data.getDefinitions()
        let title = "Available Terms:"
        const sanitizedTag = tag ? Utils.sanitizeHTML(tag.toLowerCase()) : null
        if (sanitizedTag) {
            termsToList = termsToList.filter(def => def.tags && def.tags.map(t => t.toLowerCase()).includes(sanitizedTag))
            title = `Terms tagged with '${sanitizedTag}':`
        }
        if (termsToList.length === 0) {
            const message = `No terms found${sanitizedTag ? ` with tag '${sanitizedTag}'` : ""}.`
            return { html: message, className: "text-yellow-400" }
        }
        let termsListHTML = `<p class="text-green-400">${title}</p>`
        termsToList.sort((a, b) => a.term.toLowerCase().localeCompare(b.term.toLowerCase()))
        termsToList.forEach(def => {
            let line = `- ${Utils.sanitizeHTML(def.term)}`
            if (def.aliases && def.aliases.length > 0) {
                line += ` (${Utils.sanitizeHTML(def.aliases.join(", "))})`
            }
            termsListHTML += `<p>${line}</p>`
        })
        return { html: termsListHTML }
    }

    return { process, saveDefinition }
})()

// --- APP INITIALIZATION ---
const App = (() => {
    const commandInput = document.getElementById("commandInput")
    const saveBtn = document.getElementById("save-btn")
    const cancelBtn = document.getElementById("cancel-btn")
    const definitionInput = document.getElementById("definition-input")
    const ghost = document.getElementById("input-ghost")
    const cursor = document.getElementById("cursor-blink")
    let historyIndex = -1

    function initialize() {
        Data.load()
        UI.showWelcomeMessage()
        setupEventListeners()
        updateCursorPosition() 
    }

    function updateCursorPosition() {
        ghost.textContent = commandInput.value
        cursor.style.left = `${ghost.offsetWidth}px`
    }

    function setupEventListeners() {
        commandInput.addEventListener("keydown", handleTerminalInput)
        commandInput.addEventListener("input", updateCursorPosition)
        saveBtn.addEventListener("click", Commands.saveDefinition)
        cancelBtn.addEventListener("click", UI.closeEditor)
        definitionInput.addEventListener("input", UI.updatePreview)
        document.addEventListener("keydown", handleGlobalKeydown)
        definitionInput.addEventListener("keydown", handleDefinitionInputKeydown)
    }
    
    function handleDefinitionInputKeydown(e) {
        if (e.key === "Tab") {
            e.preventDefault()
            const start = this.selectionStart
            const end = this.selectionEnd
            this.value = this.value.substring(0, start) + "  " + this.value.substring(end)
            this.selectionStart = this.selectionEnd = start + 2
        }
    }

    function handleGlobalKeydown(e) {
        const editorModal = document.getElementById("editor-modal")
        const activeElement = document.activeElement
        
        if (!editorModal.classList.contains("hidden")) {
            return
        }

        if (activeElement.tagName === "INPUT" || activeElement.tagName === "TEXTAREA") {
            return
        }
        
        if (e.ctrlKey || e.metaKey || e.altKey) {
            return
        }

        if (e.key.length === 1 || e.key === "Backspace") {
            commandInput.focus()
            handleTerminalInput(e)
        } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            commandInput.focus()
            handleTerminalInput(e)
        }
    }

    function handleTerminalInput(e) {
        const history = Data.getCommandHistory()
        if (e.key === "Enter") {
            const command = commandInput.value.trim()
            if (command) {
                Data.addToHistory(command)
                historyIndex = Data.getCommandHistory().length 
                Commands.process(command)
                commandInput.value = ""
                updateCursorPosition() 
            }
        } else if (e.key === "ArrowUp") {
            e.preventDefault()
            if (historyIndex > 0) {
                historyIndex--
                commandInput.value = history[historyIndex]
                updateCursorPosition()
            }
        } else if (e.key === "ArrowDown") {
            e.preventDefault()
            if (historyIndex < history.length - 1) {
                historyIndex++
                commandInput.value = history[historyIndex]
            } else {
                historyIndex = history.length
                commandInput.value = ""
            }
            updateCursorPosition()
        }
    }

    return { initialize }
})()

// --- Start the App ---
App.initialize()
