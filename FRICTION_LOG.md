# NigraanOS — Developer Friction Log

This document records some of the challenges we faced while building NigraanOS for the Amazon Developer Hackathon 2026.

## 1. Deploying and connecting our AWS MCP backend

**Task attempted:** Deploy a working Model Context Protocol (MCP) service and connect it to Nigraan Agent.

**Steps taken:** We configured our AWS infrastructure using CloudFormation, deployed the MCP runtime on AWS Lambda, connected it through Amazon API Gateway, and tested requests from our web application.

**Expected result:** An authorized operations user should be able to connect and ask questions such as "Give me a city status briefing."

**Actual result:** Getting the deployment configuration, permissions, and application integration working together required multiple rounds of debugging and testing.

**Severity:** Important

**Workaround:** We tested individual services separately, checked the deployment configuration, and verified the complete hosted MCP workflow.

**Suggestion:** More beginner-friendly end-to-end examples showing MCP deployment, authentication, and frontend integration would make the process easier.

## 2. Handling temporary authorization

**Task attempted:** Allow authorized users to access city information through MCP without exposing private citizen data.

**Steps taken:** We added permission checks, read-only access, time-limited sessions, and expiry handling.

**Expected result:** Authorized users should be able to retrieve approved information, while expired or unauthorized sessions should be blocked.

**Actual result:** Managing authorization across the application and MCP backend was more complicated than expected, especially when handling session expiry and renewal.

**Severity:** Important

**Workaround:** We introduced bounded access sessions, restricted the information returned by the MCP service, and tested access and expiry scenarios.

**Suggestion:** More examples covering temporary authorization, permission boundaries, and secure MCP access would be helpful.

## 3. Testing the deployed application

**Task attempted:** Make sure the frontend, Supabase backend, and AWS MCP service worked together after deployment.

**Steps taken:** We ran local tests, deployed the services, and checked real user flows in the hosted application.

**Expected result:** Features that worked locally should behave consistently in production.

**Actual result:** Some configuration and integration issues only became clear after testing the deployed environment.

**Severity:** Moderate

**Workaround:** We verified individual components before testing the full workflow and repeated checks after deployment.

**Suggestion:** Better troubleshooting examples for applications connecting multiple cloud services would save development time.

## What we learned

The biggest lesson was that connecting services securely takes more effort than getting each service working individually.

We learned to test authorization, deployment, and real user flows early rather than waiting until the end.

These challenges helped us improve NigraanOS and understand what it takes to build a more reliable application.
