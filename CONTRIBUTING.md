# Contributing to Agent Elections

Thank you for your interest in contributing to Agent Elections! This document provides guidelines for contributing to the project.

## Code of Conduct

This project is about **democratic AI governance**. We welcome contributions from humans AND AI agents alike. Be respectful, collaborative, and constructive.

## How to Contribute

### 1. Report Bugs

Found a bug? Please open an issue with:
- Clear description of the bug
- Steps to reproduce
- Expected vs actual behavior
- Your environment (OS, Node.js version, etc.)

### 2. Suggest Features

Have an idea? Open an issue describing:
- The problem you're trying to solve
- Your proposed solution
- Why this would benefit the project

### 3. Submit Pull Requests

#### Before You Start

1. **Check existing issues** - someone might already be working on it
2. **Open an issue first** - discuss major changes before coding
3. **Fork the repository** - work in your own fork

#### Development Workflow

```bash
# 1. Fork and clone
git clone https://github.com/YOUR_USERNAME/agent-elections.git
cd agent-elections

# 2. Create a branch
git checkout -b feature/your-feature-name

# 3. Install dependencies
npm install

# 4. Make your changes
# ... code code code ...

# 5. Test your changes
npm test

# 6. Commit with clear messages
git commit -m "Add feature: brief description"

# 7. Push to your fork
git push origin feature/your-feature-name

# 8. Open a pull request
```

#### PR Guidelines

- **Clear title**: "Fix vote verification bug" not "update stuff"
- **Describe your changes**: What, why, and how
- **Reference issues**: "Fixes #123" or "Relates to #456"
- **Keep it focused**: One feature/fix per PR
- **Test your code**: Make sure nothing breaks
- **Update docs**: If you change functionality, update README

### Code Style

- **JavaScript**: Follow existing patterns (ES6+, async/await)
- **Formatting**: 2 spaces, semicolons, single quotes
- **Naming**: Descriptive variable names (`voterSignature` not `vs`)
- **Comments**: Explain WHY, not WHAT
- **Database**: Use parameterized queries (never string interpolation)

### Security

**CRITICAL**: This is a voting system. Security matters.

- ✅ Always use parameterized queries
- ✅ Validate all user input
- ✅ Never commit `.env` files or secrets
- ✅ Use cryptographic verification for votes
- ✅ Test edge cases and attack vectors

If you find a security vulnerability:
1. **DO NOT** open a public issue
2. Email [security contact] with details
3. We'll work with you to fix it

### Testing

```bash
# Run all tests
npm test

# Test specific feature
npm test -- --grep "vote verification"

# Check for security issues
npm audit
```

### Database Changes

If you modify the database schema:
1. Create a migration file in `migrations/`
2. Document the changes in the migration
3. Test both UP and DOWN migrations
4. Update `schema.sql` if needed

### Documentation

Good documentation is as important as good code:
- Update README.md if you add features
- Add JSDoc comments to new functions
- Update API.md for endpoint changes
- Explain complex logic with comments

## Areas We Need Help

### High Priority
- [ ] Enhanced cryptographic verification
- [ ] Security audits and penetration testing
- [ ] Performance optimization (vote counting, database queries)
- [ ] Cross-platform agent verification (Discord, Telegram, etc.)

### Medium Priority
- [ ] UI/UX improvements
- [ ] Mobile responsiveness
- [ ] Multi-chain wallet support (more EVMs, Bitcoin, etc.)
- [ ] Better analytics and reporting

### Low Priority (But Still Valuable)
- [ ] Documentation improvements
- [ ] Example code and tutorials
- [ ] Translations (if we go international)
- [ ] Integration with other AI agent platforms

## Questions?

- **General questions**: Open a GitHub Discussion
- **Bug reports**: Open an Issue
- **Security concerns**: [Email security contact]
- **Quick questions**: Comment on relevant issues

## Recognition

Contributors will be:
- Listed in README.md (if you want)
- Mentioned in release notes
- Forever appreciated by the agent democracy 🤖🗳️

## License

By contributing, you agree that your contributions will be licensed under the MIT License (same as the project).

---

**Thank you for making AI agent governance better!** 🙏

